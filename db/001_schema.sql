-- Shevatim shop: schema + server logic. Idempotent: safe to run again at any time.
-- Runs on Supabase Postgres 17 and on pglite (scripts/dev-db.mjs). Only extension: pgcrypto (schema extensions).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists shevatim;
revoke all on schema shevatim from anon, authenticated, public;

-- ───────────────────────────── tables ─────────────────────────────
create table if not exists shevatim.categories (
  key        text primary key,
  name       jsonb not null,
  sort       integer not null default 0,
  visible    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists shevatim.items (
  id          text primary key,
  code        text not null unique,
  slug        text not null unique,
  category    text not null references shevatim.categories(key),
  name        jsonb not null,
  description jsonb not null,
  price       integer check (price is null or price >= 0),
  variants    jsonb not null default '[]'::jsonb,
  pictures    jsonb not null default '[]'::jsonb,
  tribe       text,
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sold_out    boolean not null default false,
  cloth       jsonb,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists shevatim.collections (
  id          text primary key,
  slug        text not null unique,
  name        jsonb not null,
  description jsonb not null,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  is_current  boolean not null default false,
  cover       jsonb,
  slots       jsonb not null default '{}'::jsonb,   -- { tribe: [itemId, …] } in display order
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists shevatim.reservations (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  created_at     timestamptz not null default now(),
  status         text not null default 'new'
                 check (status in ('new', 'contacted', 'confirmed', 'paid', 'ready', 'done', 'cancelled')),
  customer_name  text not null,
  customer_phone text not null,
  customer_email text not null default '',
  locale         text not null default 'he',
  note           text not null default '',
  lines          jsonb not null,
  total          bigint,
  admin_note     text not null default '',
  history        jsonb not null default '[]'::jsonb,
  ip_hash        text not null default ''
);
create index if not exists reservations_created_idx on shevatim.reservations (created_at desc);

create table if not exists shevatim.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists shevatim.admin (
  id            integer primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

create table if not exists shevatim.admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists shevatim.rate_events (
  id      bigint generated always as identity primary key,
  kind    text not null,
  ip_hash text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_events_idx on shevatim.rate_events (kind, at);

create table if not exists shevatim.upload_tickets (
  ticket     text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table shevatim.categories     enable row level security;
alter table shevatim.items          enable row level security;
alter table shevatim.collections    enable row level security;
alter table shevatim.reservations   enable row level security;
alter table shevatim.settings       enable row level security;
alter table shevatim.admin          enable row level security;
alter table shevatim.admin_sessions enable row level security;
alter table shevatim.rate_events    enable row level security;
alter table shevatim.upload_tickets enable row level security;
revoke all on all tables in schema shevatim from anon, authenticated, public;

-- a random salt for hashing client addresses, made once
insert into shevatim.settings (key, value)
values ('ipSalt', to_jsonb(encode(extensions.gen_random_bytes(16), 'hex')))
on conflict (key) do nothing;

-- ───────────────────────────── small helpers ─────────────────────────────
create or replace function shevatim.ts(p timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

create or replace function shevatim.tribe_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['reuven','shimon','levi','yehuda','dan','naftali','gad','asher','yissachar','zevulun','yosef','binyamin']
$$;

create or replace function shevatim.sha(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex')
$$;

create or replace function shevatim.setting(p_key text) returns jsonb
language sql stable set search_path = '' as $$
  select s.value from shevatim.settings s where s.key = p_key
$$;

-- salted hash of the caller's address (PostgREST puts the request headers in a setting); never the address itself
create or replace function shevatim.client_ip_hash() returns text
language plpgsql stable set search_path = '' as $$
declare
  v_headers text := nullif(current_setting('request.headers', true), '');
  v_ip text;
begin
  begin
    -- cf-connecting-ip is set by the edge and cannot be supplied by the caller; x-forwarded-for can be.
    v_ip := coalesce(
      nullif(btrim(v_headers::json ->> 'cf-connecting-ip'), ''),
      nullif(btrim(v_headers::json ->> 'x-real-ip'), ''),
      nullif(btrim(split_part(v_headers::json ->> 'x-forwarded-for', ',', 1)), ''));
  exception when others then
    v_ip := null;
  end;
  return shevatim.sha(coalesce(shevatim.setting('ipSalt') #>> '{}', '') || '|' || left(coalesce(v_ip, 'unknown'), 100));
end $$;

-- {he,en,fr} all strings, each at most p_max characters
create or replace function shevatim.is_l10n(p jsonb, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(p -> 'he') = 'string' and jsonb_typeof(p -> 'en') = 'string' and jsonb_typeof(p -> 'fr') = 'string'
    and length(p ->> 'he') <= p_max and length(p ->> 'en') <= p_max and length(p ->> 'fr') <= p_max, false)
$$;

create or replace function shevatim.l10n(p jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('he', coalesce(p ->> 'he', ''), 'en', coalesce(p ->> 'en', ''), 'fr', coalesce(p ->> 'fr', ''))
$$;

-- a json number that is a whole number between p_min and p_max
create or replace function shevatim.is_int(p jsonb, p_min bigint, p_max bigint) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^-?[0-9]{1,12}$'
    and (p #>> '{}')::bigint between p_min and p_max, false)
$$;

create or replace function shevatim.is_str(p jsonb, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p) = 'string' and length(p #>> '{}') <= p_max, false)
$$;

create or replace function shevatim.is_picture(p jsonb) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'object'
    and shevatim.is_str(p -> 'base', 500)
    and ((p ->> 'base') like '/media/%' or (p ->> 'base') like 'https://%'
         -- the shop's own storage (matters locally, where it is http://localhost)
         or (coalesce(shevatim.setting('storagePublicBase') #>> '{}', '') <> ''
             and starts_with(p ->> 'base', (shevatim.setting('storagePublicBase') #>> '{}') || '/')))
    and (p ->> 'base') !~ '[[:space:]"<>\\]'
    and jsonb_typeof(p -> 'sizes') = 'array'
    and jsonb_array_length(p -> 'sizes') between 1 and 8
    and not exists (select 1 from jsonb_array_elements(p -> 'sizes') s(v) where not shevatim.is_int(s.v, 1, 10000))
    and (p ->> 'ext') in ('webp', 'jpg', 'png') and jsonb_typeof(p -> 'ext') = 'string'
    and shevatim.is_int(p -> 'w', 1, 20000) and shevatim.is_int(p -> 'h', 1, 20000)
    and jsonb_typeof(p -> 'kind') = 'string' and (p ->> 'kind') in ('product', 'model', 'detail', 'campaign', 'render')
    and (not (p ? 'view') or (jsonb_typeof(p -> 'view') = 'string' and (p ->> 'view') in ('front', 'back', 'side', 'detail')))
    and (not (p ? 'alt') or (jsonb_typeof(p -> 'alt') = 'object' and length((p -> 'alt')::text) <= 1000))
    and length(p::text) <= 2500, false)
$$;

create or replace function shevatim.is_variants(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 20
    and not exists (
      select 1 from jsonb_array_elements(p) v(x)
      where not coalesce(
        jsonb_typeof(v.x) = 'object'
        and jsonb_typeof(v.x -> 'key') = 'string' and (v.x ->> 'key') ~ '^[a-z0-9_-]{1,24}$'
        and shevatim.is_l10n(v.x -> 'label', 80)
        and (jsonb_typeof(v.x -> 'price') = 'null' or shevatim.is_int(v.x -> 'price', 0, 100000000))
        and jsonb_typeof(v.x -> 'available') = 'boolean', false))
    and (select count(*) = count(distinct v.x ->> 'key') from jsonb_array_elements(p) v(x)), false)
$$;

create or replace function shevatim.is_cloth(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p) = 'object' and length(p::text) <= 2000
    and jsonb_typeof(p -> 'shape') = 'string' and (p ->> 'shape') in ('hooded-poncho', 'poncho', 'cropped', 'classic')
    and (jsonb_typeof(p -> 'texture') = 'null'
         or (shevatim.is_str(p -> 'texture', 500) and ((p ->> 'texture') like '/%' or (p ->> 'texture') like 'https://%')))
    and jsonb_typeof(p -> 'trim') = 'string' and (p ->> 'trim') in ('none', 'fringe', 'tassels', 'gold-fringe', 'lace')
    and coalesce((p ->> 'baseColor') ~ '^#[0-9a-fA-F]{3,8}$', false)
    and coalesce((p ->> 'trimColor') ~ '^#[0-9a-fA-F]{3,8}$', false)
    and coalesce((p ->> 'stringColor') ~ '^#[0-9a-fA-F]{3,8}$', false)
    and jsonb_typeof(p -> 'techelet') = 'boolean', false)
$$;

create or replace function shevatim.slugify(p text) returns text
language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 60)
$$;

-- ───────────────────────────── json builders ─────────────────────────────
create or replace function shevatim.settings_json() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'whatsapp',         coalesce(shevatim.setting('whatsapp') #>> '{}', ''),
    'email',            coalesce(shevatim.setting('email') #>> '{}', ''),
    'instagram',        coalesce(shevatim.setting('instagram') #>> '{}', ''),
    'calLink',          coalesce(shevatim.setting('calLink') #>> '{}', ''),
    'announcement',     shevatim.l10n(shevatim.setting('announcement')),
    'reservationsOpen', coalesce(shevatim.setting('reservationsOpen'), 'true'::jsonb) <> 'false'::jsonb,
    'slotsPerTribe',    case when shevatim.is_int(shevatim.setting('slotsPerTribe'), 1, 50)
                             then (shevatim.setting('slotsPerTribe') #>> '{}')::integer else 5 end,
    'heroLine',         shevatim.l10n(shevatim.setting('heroLine')))
$$;

create or replace function shevatim.category_json(c shevatim.categories) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('key', c.key, 'name', c.name, 'sort', c.sort, 'visible', c.visible)
$$;

create or replace function shevatim.item_json(i shevatim.items) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'code', i.code, 'slug', i.slug, 'category', i.category, 'name', i.name,
    'description', i.description, 'price', i.price, 'variants', i.variants, 'pictures', i.pictures,
    'tribe', i.tribe, 'status', i.status, 'soldOut', i.sold_out, 'cloth', i.cloth, 'sort', i.sort,
    'updatedAt', shevatim.ts(i.updated_at))
$$;

-- slots list only items the caller may see: published for the public, everything but archived for the owner
create or replace function shevatim.collection_json(c shevatim.collections, p_admin boolean) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'slug', c.slug, 'name', c.name, 'description', c.description, 'status', c.status,
    'isCurrent', c.is_current, 'cover', c.cover, 'sort', c.sort,
    'slots', (
      select jsonb_object_agg(t.k, coalesce((
        select jsonb_agg(e.id order by e.ord)
        from jsonb_array_elements_text(
               case when jsonb_typeof(c.slots -> t.k) = 'array' then c.slots -> t.k else '[]'::jsonb end
             ) with ordinality e(id, ord)
        join shevatim.items i on i.id = e.id
        where i.status = 'published' or (p_admin and i.status <> 'archived')), '[]'::jsonb))
      from unnest(shevatim.tribe_keys()) t(k)))
$$;

create or replace function shevatim.reservation_json(r shevatim.reservations) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id::text, 'code', r.code, 'createdAt', shevatim.ts(r.created_at), 'status', r.status,
    'customer', jsonb_build_object('name', r.customer_name, 'phone', r.customer_phone, 'email', r.customer_email),
    'locale', r.locale, 'note', r.note, 'lines', r.lines, 'total', r.total, 'adminNote', r.admin_note,
    'history', r.history)
$$;

create or replace function shevatim.catalog_json(p_admin boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v jsonb;
begin
  v := jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(shevatim.category_json(c) order by c.sort, c.key)
      from shevatim.categories c where c.visible or p_admin), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(shevatim.item_json(i) order by i.sort, i.code)
      from shevatim.items i where i.status = 'published' or (p_admin and i.status <> 'archived')), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(shevatim.collection_json(c, p_admin) order by c.sort, c.id)
      from shevatim.collections c where c.status = 'published' or p_admin), '[]'::jsonb),
    'settings', shevatim.settings_json());
  return v || jsonb_build_object('version', md5(v::text));
end $$;

-- removes an item from every tribe of every collection
create or replace function shevatim.remove_from_slots(p_item text) returns void
language sql set search_path = '' as $$
  update shevatim.collections c
  set slots = (
        select coalesce(jsonb_object_agg(s.key,
                 case when jsonb_typeof(s.value) = 'array' then (
                   select coalesce(jsonb_agg(e.v order by e.ord), '[]'::jsonb)
                   from jsonb_array_elements(s.value) with ordinality e(v, ord)
                   where e.v #>> '{}' <> p_item)
                 else '[]'::jsonb end), '{}'::jsonb)
        from jsonb_each(c.slots) s),
      updated_at = now()
  where c.slots::text like '%' || p_item || '%'
$$;

create or replace function shevatim.new_reservation_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(5);
  v_code text := 'SHV-';
begin
  for n in 0..4 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, n) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_code;
end $$;

-- ───────────────────────────── owner helpers (no grant to anon) ─────────────────────────────
create or replace function shevatim.set_admin_password(p text) returns void
language plpgsql set search_path = '' as $$
begin
  if p is null or length(p) < 10 or length(p) > 200 then
    raise exception 'weak_password';
  end if;
  insert into shevatim.admin (id, password_hash, updated_at)
  values (1, extensions.crypt(p, extensions.gen_salt('bf', 10)), now())
  on conflict (id) do update set password_hash = excluded.password_hash, updated_at = now();
  delete from shevatim.admin_sessions;
end $$;

create or replace function shevatim.set_setting(key text, value jsonb) returns void
language sql set search_path = '' as $$
  insert into shevatim.settings as s (key, value, updated_at) values ($1, $2, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
$$;

-- Loads a Catalog (db/seed.json). Only adds what is missing: never overwrites a row that already exists.
create or replace function shevatim.load_seed(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  n_cat integer; n_item integer; n_col integer; n_set integer;
begin
  insert into shevatim.categories (key, name, sort, visible)
  select c ->> 'key', shevatim.l10n(c -> 'name'), coalesce((c ->> 'sort')::integer, 0), coalesce((c ->> 'visible')::boolean, true)
  from jsonb_array_elements(coalesce(p -> 'categories', '[]'::jsonb)) c
  on conflict do nothing;
  get diagnostics n_cat = row_count;

  insert into shevatim.items (id, code, slug, category, name, description, price, variants, pictures, tribe,
                              status, sold_out, cloth, sort, updated_at)
  select i ->> 'id', i ->> 'code', i ->> 'slug', i ->> 'category', shevatim.l10n(i -> 'name'),
         shevatim.l10n(i -> 'description'), (i ->> 'price')::integer, coalesce(i -> 'variants', '[]'::jsonb),
         coalesce(i -> 'pictures', '[]'::jsonb), i ->> 'tribe', coalesce(i ->> 'status', 'draft'),
         coalesce((i ->> 'soldOut')::boolean, false), nullif(i -> 'cloth', 'null'::jsonb),
         coalesce((i ->> 'sort')::integer, 0), coalesce((i ->> 'updatedAt')::timestamptz, now())
  from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) i
  on conflict do nothing;
  get diagnostics n_item = row_count;

  insert into shevatim.collections (id, slug, name, description, status, is_current, cover, slots, sort)
  select c ->> 'id', c ->> 'slug', shevatim.l10n(c -> 'name'), shevatim.l10n(c -> 'description'),
         coalesce(c ->> 'status', 'draft'),
         coalesce((c ->> 'isCurrent')::boolean, false) and not exists (select 1 from shevatim.collections x where x.is_current),
         nullif(c -> 'cover', 'null'::jsonb), coalesce(c -> 'slots', '{}'::jsonb), coalesce((c ->> 'sort')::integer, 0)
  from jsonb_array_elements(coalesce(p -> 'collections', '[]'::jsonb)) c
  on conflict do nothing;
  get diagnostics n_col = row_count;

  insert into shevatim.settings (key, value)
  select s.key, s.value from jsonb_each(coalesce(p -> 'settings', '{}'::jsonb)) s
  on conflict do nothing;
  get diagnostics n_set = row_count;

  return jsonb_build_object('categories', n_cat, 'items', n_item, 'collections', n_col, 'settings', n_set);
end $$;

-- true while an upload ticket is alive; used by the storage policy (db/002_storage.sql) and the dev server
create or replace function shevatim.upload_ticket_ok(p_ticket text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from shevatim.upload_tickets t where t.ticket = p_ticket and t.expires_at > now())
$$;

-- ───────────────────────────── public: catalogue ─────────────────────────────
create or replace function public.shv_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select shevatim.catalog_json(false)
$$;

-- ───────────────────────────── public: reserve ─────────────────────────────
create or replace function public.shv_reserve(p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_customer jsonb; v_name text; v_phone text; v_digits text; v_email text; v_note text; v_locale text;
  v_lines jsonb; v_line jsonb; v_out jsonb := '[]'::jsonb;
  v_item shevatim.items; v_variant jsonb; v_vkey text; v_qty integer; v_unit bigint;
  v_total bigint := 0; v_unpriced boolean := false;
  v_ip text; v_code text; v_now timestamptz := now();
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or length(p_payload::text) > 200000 then
    raise exception 'invalid';
  end if;

  -- honeypot: a filled "website" field is a bot. Answer as if it worked, keep nothing.
  if p_payload ? 'website' and coalesce(p_payload ->> 'website', '') <> '' then
    return jsonb_build_object('code', shevatim.new_reservation_code(), 'total', null);
  end if;

  if not (shevatim.settings_json() ->> 'reservationsOpen')::boolean then
    raise exception 'closed';
  end if;

  v_customer := p_payload -> 'customer';
  if v_customer is null or jsonb_typeof(v_customer) <> 'object'
     or not shevatim.is_str(v_customer -> 'name', 200) or not shevatim.is_str(v_customer -> 'phone', 40) then
    raise exception 'invalid';
  end if;
  v_name := btrim(v_customer ->> 'name');
  v_phone := btrim(v_customer ->> 'phone');
  v_digits := regexp_replace(regexp_replace(v_phone, '[[:space:]()-]', '', 'g'), '^\+', '');
  if length(v_name) < 2 or length(v_name) > 80 or v_digits !~ '^[0-9]{7,15}$' then
    raise exception 'invalid';
  end if;

  if v_customer ? 'email' and jsonb_typeof(v_customer -> 'email') not in ('string', 'null') then
    raise exception 'invalid';
  end if;
  v_email := btrim(coalesce(v_customer ->> 'email', ''));
  if v_email <> '' and (length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$') then
    raise exception 'invalid';
  end if;

  if p_payload ? 'note' and jsonb_typeof(p_payload -> 'note') not in ('string', 'null') then
    raise exception 'invalid';
  end if;
  v_note := coalesce(p_payload ->> 'note', '');
  if length(v_note) > 600 then raise exception 'invalid'; end if;

  if p_payload ? 'locale' and jsonb_typeof(p_payload -> 'locale') <> 'string' then
    raise exception 'invalid';
  end if;
  v_locale := coalesce(p_payload ->> 'locale', 'he');
  if v_locale not in ('he', 'en', 'fr') then raise exception 'invalid'; end if;

  v_lines := p_payload -> 'lines';
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 30 then
    raise exception 'invalid';
  end if;
  for v_line in select l.x from jsonb_array_elements(v_lines) l(x) loop
    if jsonb_typeof(v_line) <> 'object' or not shevatim.is_str(v_line -> 'itemId', 80)
       or not shevatim.is_int(v_line -> 'qty', 1, 10)
       or (v_line ? 'variantKey' and jsonb_typeof(v_line -> 'variantKey') not in ('string', 'null'))
       or length(coalesce(v_line ->> 'variantKey', '')) > 40 then
      raise exception 'invalid';
    end if;
  end loop;

  -- rate limits (one reservation at a time, so the counts are exact)
  -- (old rate events are cleared by the back-office login, see shv_admin_login; the counts below use time windows)
  perform pg_advisory_xact_lock(7340101);
  v_ip := shevatim.client_ip_hash();
  if (select count(*) from shevatim.rate_events e
      where e.kind = 'reserve' and e.ip_hash = v_ip and e.at > v_now - interval '1 hour') >= 6
     or (select count(*) from shevatim.rate_events e
         where e.kind = 'reserve' and e.at > v_now - interval '1 day') >= 300 then
    raise exception 'too_many';
  end if;

  -- lines: everything about the item comes from the database
  for v_line in select l.x from jsonb_array_elements(v_lines) l(x) loop
    select * into v_item from shevatim.items i where i.id = v_line ->> 'itemId';
    if not found or v_item.status <> 'published' or v_item.sold_out then
      raise exception 'item_unavailable';
    end if;
    v_vkey := v_line ->> 'variantKey';
    v_variant := null;
    if jsonb_array_length(v_item.variants) = 0 then
      if v_vkey is not null then raise exception 'item_unavailable'; end if;
    else
      if v_vkey is null then raise exception 'item_unavailable'; end if;
      select x.v into v_variant from jsonb_array_elements(v_item.variants) x(v) where x.v ->> 'key' = v_vkey limit 1;
      if v_variant is null or not coalesce((v_variant ->> 'available')::boolean, false) then
        raise exception 'item_unavailable';
      end if;
    end if;
    v_qty := (v_line ->> 'qty')::integer;
    v_unit := coalesce((v_variant ->> 'price')::bigint, v_item.price::bigint);
    if v_unit is null then v_unpriced := true; else v_total := v_total + v_unit * v_qty; end if;
    v_out := v_out || jsonb_build_object(
      'itemId', v_item.id, 'code', v_item.code, 'name', v_item.name, 'variantKey', v_vkey,
      'variantLabel', case when v_variant is null then null else v_variant -> 'label' end,
      'qty', v_qty, 'unitPrice', v_unit);
  end loop;
  if v_unpriced then v_total := null; end if;

  -- a short human code; the unique constraint decides, we try again on a clash
  for attempt in 1..12 loop
    v_code := shevatim.new_reservation_code();
    begin
      insert into shevatim.reservations (code, created_at, status, customer_name, customer_phone, customer_email,
                                         locale, note, lines, total, history, ip_hash)
      values (v_code, v_now, 'new', v_name, v_phone, v_email, v_locale, v_note, v_out, v_total,
              jsonb_build_array(jsonb_build_object('at', shevatim.ts(v_now), 'status', 'new', 'note', '')), v_ip);
      insert into shevatim.rate_events (kind, ip_hash, at) values ('reserve', v_ip, v_now);
      return jsonb_build_object('code', v_code, 'total', v_total);
    exception when unique_violation then
      null; -- same code drawn twice: draw again
    end;
  end loop;
  raise exception 'server_busy';
end $$;

-- ───────────────────────────── public: owner login ─────────────────────────────
-- A wrong password must leave a trace for the rate limit, and a raised exception would roll that trace back.
-- So "bad_password" is answered by returning normally with PostgREST's response.status set to 400 and the
-- body {"message":"bad_password"}: the browser sees exactly what a raised error looks like.
create or replace function public.shv_admin_login(p_password text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash text; v_ok boolean; v_ip text; v_token text; v_expires timestamptz; v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(7340102);
  v_ip := shevatim.client_ip_hash();
  select a.password_hash into v_hash from shevatim.admin a where a.id = 1;
  -- always pay for one bcrypt, whatever happens next
  v_ok := coalesce(extensions.crypt(left(coalesce(p_password, ''), 200), coalesce(v_hash, extensions.gen_salt('bf', 10))) = v_hash, false);

  delete from shevatim.rate_events where at < v_now - interval '2 days';
  delete from shevatim.admin_sessions where expires_at < v_now;
  delete from shevatim.upload_tickets where expires_at < v_now;

  if (select count(*) from shevatim.rate_events e
      where e.kind = 'login_fail' and e.ip_hash = v_ip and e.at > v_now - interval '15 minutes') >= 8
     or (select count(*) from shevatim.rate_events e
         where e.kind = 'login_fail' and e.at > v_now - interval '15 minutes') >= 40 then
    raise exception 'too_many';
  end if;

  if not v_ok or p_password is null or length(p_password) > 200 then
    insert into shevatim.rate_events (kind, ip_hash, at) values ('login_fail', v_ip, v_now);
    perform set_config('response.status', '400', true);
    return jsonb_build_object('message', 'bad_password', 'code', 'P0001');
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := v_now + interval '12 hours';
  insert into shevatim.admin_sessions (token_hash, created_at, expires_at) values (shevatim.sha(v_token), v_now, v_expires);
  return jsonb_build_object('token', v_token, 'expiresAt', shevatim.ts(v_expires));
end $$;

-- ───────────────────────────── back office actions ─────────────────────────────
create or replace function shevatim.admin_item_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id text := nullif(p ->> 'id', '');
  v_row shevatim.items; v_cat text; v_prefix text; v_n integer; v_code text; v_slug text; v_base text; v_try integer := 1;
begin
  if p ? 'name' and (not shevatim.is_l10n(p -> 'name', 120)
                     or btrim((p -> 'name' ->> 'he') || (p -> 'name' ->> 'en') || (p -> 'name' ->> 'fr')) = '') then
    raise exception 'invalid'; end if;
  if p ? 'description' and not shevatim.is_l10n(p -> 'description', 2000) then raise exception 'invalid'; end if;
  if p ? 'price' and jsonb_typeof(p -> 'price') <> 'null' and not shevatim.is_int(p -> 'price', 0, 100000000) then
    raise exception 'invalid'; end if;
  if p ? 'variants' and not shevatim.is_variants(p -> 'variants') then raise exception 'invalid'; end if;
  if p ? 'pictures' and (jsonb_typeof(p -> 'pictures') <> 'array' or jsonb_array_length(p -> 'pictures') > 12
       or exists (select 1 from jsonb_array_elements(p -> 'pictures') x(v) where not shevatim.is_picture(x.v))) then
    raise exception 'invalid'; end if;
  if p ? 'tribe' and jsonb_typeof(p -> 'tribe') <> 'null'
     and not (jsonb_typeof(p -> 'tribe') = 'string' and (p ->> 'tribe') = any (shevatim.tribe_keys())) then
    raise exception 'invalid'; end if;
  if p ? 'status' and not (jsonb_typeof(p -> 'status') = 'string' and (p ->> 'status') in ('draft', 'published', 'archived')) then
    raise exception 'invalid'; end if;
  if p ? 'soldOut' and jsonb_typeof(p -> 'soldOut') <> 'boolean' then raise exception 'invalid'; end if;
  if p ? 'cloth' and jsonb_typeof(p -> 'cloth') <> 'null' and not shevatim.is_cloth(p -> 'cloth') then
    raise exception 'invalid'; end if;
  if p ? 'sort' and not shevatim.is_int(p -> 'sort', -1000000, 1000000) then raise exception 'invalid'; end if;
  if p ? 'category' and (jsonb_typeof(p -> 'category') <> 'string'
       or not exists (select 1 from shevatim.categories c where c.key = p ->> 'category')) then
    raise exception 'invalid'; end if;
  if p ? 'code' and not (jsonb_typeof(p -> 'code') = 'string' and (p ->> 'code') ~ '^[a-z0-9][a-z0-9-]{0,15}$') then
    raise exception 'invalid'; end if;
  if p ? 'slug' and not (jsonb_typeof(p -> 'slug') = 'string' and length(p ->> 'slug') <= 80
                         and (p ->> 'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'invalid'; end if;

  if v_id is null then
    -- create
    if not (p ? 'name') or not (p ? 'category') then raise exception 'invalid'; end if;
    v_cat := p ->> 'category';
    if p ? 'code' then
      v_code := p ->> 'code';
    else
      v_prefix := coalesce(nullif(left(regexp_replace(v_cat, '[^a-z]', '', 'g'), 2), ''), 'it');
      select coalesce(max(substr(i.code, length(v_prefix) + 1)::integer), 0) + 1 into v_n
      from shevatim.items i where i.code ~ ('^' || v_prefix || '[0-9]{1,6}$');
      loop
        v_code := v_prefix || lpad(v_n::text, 2, '0');
        exit when not exists (select 1 from shevatim.items i where i.code = v_code or i.id = v_code);
        v_n := v_n + 1;
      end loop;
    end if;
    v_id := v_code;
    if exists (select 1 from shevatim.items i where i.id = v_id or i.code = v_code) then raise exception 'invalid'; end if;
    if p ? 'slug' then
      v_slug := p ->> 'slug';
    else
      v_base := btrim(shevatim.slugify(p -> 'name' ->> 'en') || '-' || v_code, '-');
      v_slug := v_base;
      while exists (select 1 from shevatim.items i where i.slug = v_slug) loop
        v_try := v_try + 1;
        v_slug := v_base || '-' || v_try;
      end loop;
    end if;
    insert into shevatim.items (id, code, slug, category, name, description, price, variants, pictures, tribe,
                                status, sold_out, cloth, sort, updated_at)
    values (v_id, v_code, v_slug, v_cat, p -> 'name',
            coalesce(p -> 'description', shevatim.l10n(null)),
            (p ->> 'price')::integer, coalesce(p -> 'variants', '[]'::jsonb), coalesce(p -> 'pictures', '[]'::jsonb),
            p ->> 'tribe', coalesce(p ->> 'status', 'draft'), coalesce((p ->> 'soldOut')::boolean, false),
            nullif(p -> 'cloth', 'null'::jsonb),
            coalesce((p ->> 'sort')::integer, (select coalesce(max(i.sort), -10) + 10 from shevatim.items i)), now())
    returning * into v_row;
  else
    if length(v_id) > 80 then raise exception 'invalid'; end if;
    update shevatim.items i set
      code        = case when p ? 'code' then p ->> 'code' else i.code end,
      slug        = case when p ? 'slug' then p ->> 'slug' else i.slug end,
      category    = case when p ? 'category' then p ->> 'category' else i.category end,
      name        = case when p ? 'name' then p -> 'name' else i.name end,
      description = case when p ? 'description' then p -> 'description' else i.description end,
      price       = case when p ? 'price' then (p ->> 'price')::integer else i.price end,
      variants    = case when p ? 'variants' then p -> 'variants' else i.variants end,
      pictures    = case when p ? 'pictures' then p -> 'pictures' else i.pictures end,
      tribe       = case when p ? 'tribe' then p ->> 'tribe' else i.tribe end,
      status      = case when p ? 'status' then p ->> 'status' else i.status end,
      sold_out    = case when p ? 'soldOut' then (p ->> 'soldOut')::boolean else i.sold_out end,
      cloth       = case when p ? 'cloth' then nullif(p -> 'cloth', 'null'::jsonb) else i.cloth end,
      sort        = case when p ? 'sort' then (p ->> 'sort')::integer else i.sort end,
      updated_at  = now()
    where i.id = v_id
    returning * into v_row;
    if not found then raise exception 'invalid'; end if;
  end if;
  if v_row.status = 'archived' then perform shevatim.remove_from_slots(v_row.id); end if;
  return shevatim.item_json(v_row);
end $$;

create or replace function shevatim.admin_collection_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_id text := nullif(p ->> 'id', '');
  v_row shevatim.collections; v_slug text; v_base text; v_try integer := 1;
begin
  if p ? 'name' and (not shevatim.is_l10n(p -> 'name', 120)
                     or btrim((p -> 'name' ->> 'he') || (p -> 'name' ->> 'en') || (p -> 'name' ->> 'fr')) = '') then
    raise exception 'invalid'; end if;
  if p ? 'description' and not shevatim.is_l10n(p -> 'description', 2000) then raise exception 'invalid'; end if;
  if p ? 'status' and not (jsonb_typeof(p -> 'status') = 'string' and (p ->> 'status') in ('draft', 'published')) then
    raise exception 'invalid'; end if;
  if p ? 'isCurrent' and jsonb_typeof(p -> 'isCurrent') <> 'boolean' then raise exception 'invalid'; end if;
  if p ? 'cover' and jsonb_typeof(p -> 'cover') <> 'null' and not shevatim.is_picture(p -> 'cover') then
    raise exception 'invalid'; end if;
  if p ? 'sort' and not shevatim.is_int(p -> 'sort', -1000000, 1000000) then raise exception 'invalid'; end if;
  if p ? 'slug' and not (jsonb_typeof(p -> 'slug') = 'string' and length(p ->> 'slug') <= 80
                         and (p ->> 'slug') ~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'invalid'; end if;

  if v_id is null then
    if not (p ? 'name') then raise exception 'invalid'; end if;
    v_base := coalesce(nullif(case when p ? 'slug' then p ->> 'slug' else shevatim.slugify(p -> 'name' ->> 'en') end, ''), 'collection');
    v_slug := v_base;
    while exists (select 1 from shevatim.collections c where c.slug = v_slug or c.id = v_slug) loop
      v_try := v_try + 1;
      v_slug := v_base || '-' || v_try;
    end loop;
    insert into shevatim.collections (id, slug, name, description, status, is_current, cover, slots, sort)
    values (v_slug, v_slug, p -> 'name', coalesce(p -> 'description', shevatim.l10n(null)),
            coalesce(p ->> 'status', 'draft'), coalesce((p ->> 'isCurrent')::boolean, false),
            nullif(p -> 'cover', 'null'::jsonb), '{}'::jsonb,
            coalesce((p ->> 'sort')::integer, (select coalesce(max(c.sort), -10) + 10 from shevatim.collections c)))
    returning * into v_row;
  else
    update shevatim.collections c set
      slug        = case when p ? 'slug' then p ->> 'slug' else c.slug end,
      name        = case when p ? 'name' then p -> 'name' else c.name end,
      description = case when p ? 'description' then p -> 'description' else c.description end,
      status      = case when p ? 'status' then p ->> 'status' else c.status end,
      is_current  = case when p ? 'isCurrent' then (p ->> 'isCurrent')::boolean else c.is_current end,
      cover       = case when p ? 'cover' then nullif(p -> 'cover', 'null'::jsonb) else c.cover end,
      sort        = case when p ? 'sort' then (p ->> 'sort')::integer else c.sort end,
      updated_at  = now()
    where c.id = v_id
    returning * into v_row;
    if not found then raise exception 'invalid'; end if;
  end if;
  if v_row.is_current then
    update shevatim.collections c set is_current = false, updated_at = now() where c.id <> v_row.id and c.is_current;
  end if;
  return shevatim.collection_json(v_row, true);
end $$;

create or replace function shevatim.admin_collection_slots(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row shevatim.collections; v_tribe text := p ->> 'tribe'; v_ids jsonb := p -> 'itemIds'; v_n integer;
begin
  if not shevatim.is_str(p -> 'collectionId', 80) or jsonb_typeof(p -> 'tribe') is distinct from 'string'
     or not (v_tribe = any (shevatim.tribe_keys()))
     or v_ids is null or jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) > 200
     or exists (select 1 from jsonb_array_elements(v_ids) x(v) where not shevatim.is_str(x.v, 80)) then
    raise exception 'invalid';
  end if;
  select * into v_row from shevatim.collections c where c.id = p ->> 'collectionId' for update;
  if not found then raise exception 'invalid'; end if;
  v_n := jsonb_array_length(v_ids);
  if (select count(distinct x.v) from jsonb_array_elements_text(v_ids) x(v)) <> v_n then raise exception 'invalid'; end if;
  if exists (select 1 from jsonb_array_elements_text(v_ids) x(v)
             where not exists (select 1 from shevatim.items i where i.id = x.v and i.status <> 'archived')) then
    raise exception 'invalid';
  end if;
  if v_n > (shevatim.settings_json() ->> 'slotsPerTribe')::integer then raise exception 'slots_full'; end if;
  update shevatim.collections c
  set slots = jsonb_set(case when jsonb_typeof(c.slots) = 'object' then c.slots else '{}'::jsonb end, array[v_tribe], v_ids, true),
      updated_at = now()
  where c.id = v_row.id
  returning * into v_row;
  return shevatim.collection_json(v_row, true);
end $$;

create or replace function shevatim.admin_category_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_key text := p ->> 'key'; v_row shevatim.categories;
begin
  if jsonb_typeof(p -> 'key') is distinct from 'string' or v_key !~ '^[a-z0-9][a-z0-9-]{0,31}$' then raise exception 'invalid'; end if;
  if p ? 'name' and (not shevatim.is_l10n(p -> 'name', 80)
                     or btrim((p -> 'name' ->> 'he') || (p -> 'name' ->> 'en') || (p -> 'name' ->> 'fr')) = '') then
    raise exception 'invalid'; end if;
  if p ? 'sort' and not shevatim.is_int(p -> 'sort', -1000000, 1000000) then raise exception 'invalid'; end if;
  if p ? 'visible' and jsonb_typeof(p -> 'visible') <> 'boolean' then raise exception 'invalid'; end if;

  update shevatim.categories c set
    name       = case when p ? 'name' then p -> 'name' else c.name end,
    sort       = case when p ? 'sort' then (p ->> 'sort')::integer else c.sort end,
    visible    = case when p ? 'visible' then (p ->> 'visible')::boolean else c.visible end,
    updated_at = now()
  where c.key = v_key
  returning * into v_row;
  if not found then
    if not (p ? 'name') then raise exception 'invalid'; end if;
    insert into shevatim.categories (key, name, sort, visible)
    values (v_key, p -> 'name',
            coalesce((p ->> 'sort')::integer, (select coalesce(max(c.sort), -10) + 10 from shevatim.categories c)),
            coalesce((p ->> 'visible')::boolean, true))
    returning * into v_row;
  end if;
  return shevatim.category_json(v_row);
end $$;

create or replace function shevatim.admin_settings_save(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v text;
begin
  if p ? 'whatsapp' then
    if not shevatim.is_str(p -> 'whatsapp', 40) then raise exception 'invalid'; end if;
    v := regexp_replace(p ->> 'whatsapp', '[^0-9]', '', 'g');
    if length(v) > 15 or (v <> '' and length(v) < 7) then raise exception 'invalid'; end if;
    perform shevatim.set_setting('whatsapp', to_jsonb(v));
  end if;
  if p ? 'email' then
    if not shevatim.is_str(p -> 'email', 254) then raise exception 'invalid'; end if;
    v := btrim(p ->> 'email');
    if v <> '' and v !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:].]+$' then raise exception 'invalid'; end if;
    perform shevatim.set_setting('email', to_jsonb(v));
  end if;
  if p ? 'instagram' then
    if not shevatim.is_str(p -> 'instagram', 300) then raise exception 'invalid'; end if;
    v := btrim(p ->> 'instagram');
    if v <> '' and (v !~ '^https://[^[:space:]"<>]+$') then raise exception 'invalid'; end if;
    perform shevatim.set_setting('instagram', to_jsonb(v));
  end if;
  if p ? 'calLink' then
    if not shevatim.is_str(p -> 'calLink', 300) then raise exception 'invalid'; end if;
    v := btrim(p ->> 'calLink');
    if v <> '' and (v !~ '^https://[^[:space:]"<>]+$') then raise exception 'invalid'; end if;
    perform shevatim.set_setting('calLink', to_jsonb(v));
  end if;
  if p ? 'announcement' then
    if not shevatim.is_l10n(p -> 'announcement', 300) then raise exception 'invalid'; end if;
    perform shevatim.set_setting('announcement', shevatim.l10n(p -> 'announcement'));
  end if;
  if p ? 'heroLine' then
    if not shevatim.is_l10n(p -> 'heroLine', 300) then raise exception 'invalid'; end if;
    perform shevatim.set_setting('heroLine', shevatim.l10n(p -> 'heroLine'));
  end if;
  if p ? 'reservationsOpen' then
    if jsonb_typeof(p -> 'reservationsOpen') <> 'boolean' then raise exception 'invalid'; end if;
    perform shevatim.set_setting('reservationsOpen', p -> 'reservationsOpen');
  end if;
  if p ? 'slotsPerTribe' then
    if not shevatim.is_int(p -> 'slotsPerTribe', 1, 24) then raise exception 'invalid'; end if;
    perform shevatim.set_setting('slotsPerTribe', p -> 'slotsPerTribe');
  end if;
  return shevatim.settings_json();
end $$;

create or replace function shevatim.admin_reservation_update(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row shevatim.reservations; v_status text; v_note text;
begin
  if jsonb_typeof(p -> 'id') is distinct from 'string'
     or (p ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid'; end if;
  if p ? 'status' and not (jsonb_typeof(p -> 'status') = 'string'
       and (p ->> 'status') in ('new', 'contacted', 'confirmed', 'paid', 'ready', 'done', 'cancelled')) then
    raise exception 'invalid'; end if;
  if p ? 'adminNote' and not shevatim.is_str(p -> 'adminNote', 2000) then raise exception 'invalid'; end if;
  if not (p ? 'status') and not (p ? 'adminNote') then raise exception 'invalid'; end if;

  select * into v_row from shevatim.reservations r where r.id = (p ->> 'id')::uuid for update;
  if not found then raise exception 'invalid'; end if;
  v_status := coalesce(p ->> 'status', v_row.status);
  v_note := coalesce(p ->> 'adminNote', v_row.admin_note);
  update shevatim.reservations r
  set status = v_status, admin_note = v_note,
      history = r.history || jsonb_build_object('at', shevatim.ts(now()), 'status', v_status,
                                                'note', coalesce(p ->> 'adminNote', ''))
  where r.id = v_row.id
  returning * into v_row;
  return shevatim.reservation_json(v_row);
end $$;

create or replace function shevatim.admin_dispatch(p_action text, p jsonb, p_session text) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_hash text; v_ticket text; v_n integer;
begin
  case p_action
  when 'state' then
    return jsonb_build_object(
      'catalog', shevatim.catalog_json(true),
      'reservations', coalesce((
        select jsonb_agg(shevatim.reservation_json(r) order by r.created_at desc, r.code)
        from (select * from shevatim.reservations x order by x.created_at desc, x.code limit 500) r), '[]'::jsonb),
      'counts', (
        select jsonb_build_object(
          'new', count(*) filter (where r.status = 'new'),
          'open', count(*) filter (where r.status not in ('done', 'cancelled')),
          'total', count(*))
        from shevatim.reservations r));
  when 'logout' then
    delete from shevatim.admin_sessions s where s.token_hash = p_session;
    return jsonb_build_object('ok', true);
  when 'password.change' then
    if not shevatim.is_str(p -> 'current', 200) or jsonb_typeof(p -> 'next') is distinct from 'string' then
      raise exception 'invalid'; end if;
    select a.password_hash into v_hash from shevatim.admin a where a.id = 1;
    if v_hash is null or extensions.crypt(p ->> 'current', v_hash) <> v_hash then raise exception 'bad_password'; end if;
    if length(p ->> 'next') < 10 then raise exception 'weak_password'; end if;
    if length(p ->> 'next') > 200 then raise exception 'invalid'; end if;
    update shevatim.admin a
    set password_hash = extensions.crypt(p ->> 'next', extensions.gen_salt('bf', 10)), updated_at = now() where a.id = 1;
    delete from shevatim.admin_sessions s where s.token_hash <> p_session; -- other devices must log in again
    return jsonb_build_object('ok', true);
  when 'item.save' then
    return shevatim.admin_item_save(p);
  when 'item.archive' then
    if not shevatim.is_str(p -> 'id', 80) then raise exception 'invalid'; end if;
    update shevatim.items i set status = 'archived', updated_at = now() where i.id = p ->> 'id';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'invalid'; end if;
    perform shevatim.remove_from_slots(p ->> 'id');
    return jsonb_build_object('ok', true);
  when 'collection.save' then
    return shevatim.admin_collection_save(p);
  when 'collection.delete' then
    if not shevatim.is_str(p -> 'id', 80) then raise exception 'invalid'; end if;
    if exists (select 1 from shevatim.collections c where c.id = p ->> 'id' and c.is_current) then raise exception 'is_current'; end if;
    delete from shevatim.collections c where c.id = p ->> 'id';
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception 'invalid'; end if;
    return jsonb_build_object('ok', true);
  when 'collection.slots' then
    return shevatim.admin_collection_slots(p);
  when 'category.save' then
    return shevatim.admin_category_save(p);
  when 'settings.save' then
    return shevatim.admin_settings_save(p);
  when 'reservation.update' then
    return shevatim.admin_reservation_update(p);
  when 'upload.ticket' then
    v_ticket := encode(extensions.gen_random_bytes(16), 'hex');
    insert into shevatim.upload_tickets (ticket, expires_at) values (v_ticket, now() + interval '15 minutes');
    return jsonb_build_object('ticket', v_ticket, 'bucket', 'shevatim-media', 'prefix', 'u/' || v_ticket,
                              'publicBase', coalesce(shevatim.setting('storagePublicBase') #>> '{}', ''));
  else
    raise exception 'invalid';
  end case;
end $$;

-- ───────────────────────────── public: back office ─────────────────────────────
create or replace function public.shv_admin(p_token text, p_action text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session text; v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'unauthorized'; end if;
  v_session := shevatim.sha(p_token);
  -- sliding session: every good call pushes the end 12 hours out
  update shevatim.admin_sessions s set expires_at = now() + interval '12 hours'
  where s.token_hash = v_session and s.expires_at > now();
  if not found then raise exception 'unauthorized'; end if;

  delete from shevatim.admin_sessions where expires_at < now();
  delete from shevatim.upload_tickets where expires_at < now() - interval '1 hour';

  if p_action is null or jsonb_typeof(v_payload) <> 'object' or length(v_payload::text) > 200000 then
    raise exception 'invalid';
  end if;
  begin
    return shevatim.admin_dispatch(p_action, v_payload, v_session);
  exception
    when data_exception or integrity_constraint_violation then
      raise exception 'invalid'; -- a value that slipped past the checks (duplicate slug, bad number…)
  end;
end $$;

-- ───────────────────────────── privileges ─────────────────────────────
revoke all on all functions in schema shevatim from public, anon, authenticated;
grant execute on function shevatim.upload_ticket_ok(text) to anon, authenticated;

revoke all on function public.shv_catalog() from public;
revoke all on function public.shv_reserve(jsonb) from public;
revoke all on function public.shv_admin_login(text) from public;
revoke all on function public.shv_admin(text, text, jsonb) from public;
grant execute on function public.shv_catalog() to anon, authenticated;
grant execute on function public.shv_reserve(jsonb) to anon, authenticated;
grant execute on function public.shv_admin_login(text) to anon, authenticated;
grant execute on function public.shv_admin(text, text, jsonb) to anon, authenticated;

-- tell PostgREST about new or changed functions (Supabase also does this by itself after DDL)
notify pgrst, 'reload schema';
