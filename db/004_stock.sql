-- Shevatim: stock. Applied after 001_schema.sql (any time; it only adds and replaces). Safe to run again.
--
-- How it works
--   * shevatim.stock holds a count per piece and size ('' for a piece without sizes). No row, or a null count,
--     means "not counted": the piece behaves exactly as before stock existed.
--   * A reservation takes its pieces out of the counted stock at once (under the same lock as every reservation);
--     each reservation line remembers whether it took stock ("held"). Cancelling a reservation puts held pieces back;
--     re-opening a cancelled one takes them again (and refuses if they are no longer there).
--   * The shop sees only what it needs: a size with nothing left is unavailable, a piece whose counted sizes are all
--     gone is sold out, and small counts (10 or fewer) are given as "left" so the bag cannot ask for more.
--   * The owner sees the count, the pieces held by open reservations and the pieces sold, and every change is
--     written to shevatim.stock_moves.
--   * The owner's own "available" switches and the "sold out" switch are never changed by stock.
-- This file contains no statement that removes rows: counts are switched off by setting them to null.

create table if not exists shevatim.stock (
  item_id     text not null references shevatim.items(id),
  variant_key text not null default '',
  qty         integer check (qty is null or qty >= 0),
  updated_at  timestamptz not null default now(),
  primary key (item_id, variant_key)
);

create table if not exists shevatim.stock_moves (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  item_id     text not null,
  variant_key text not null default '',
  delta       integer not null,
  qty_after   integer,
  reason      text not null check (reason in ('count', 'adjust', 'reserve', 'release', 'retake')),
  ref         text not null default ''
);
create index if not exists stock_moves_item_idx on shevatim.stock_moves (item_id, id desc);

alter table shevatim.stock       enable row level security;
alter table shevatim.stock_moves enable row level security;
revoke all on all tables in schema shevatim from anon, authenticated, public;

-- ───────────────────────────── reading the counts ─────────────────────────────
-- the count of one size, or null when it is not counted
create or replace function shevatim.stock_of(p_item text, p_vkey text) returns integer
language sql stable set search_path = '' as $$
  select s.qty from shevatim.stock s where s.item_id = p_item and s.variant_key = coalesce(p_vkey, '')
$$;

-- pieces of one size that reservations in the given statuses took from the stock
create or replace function shevatim.stock_held(p_item text, p_vkey text, p_statuses text[]) returns integer
language sql stable set search_path = '' as $$
  select coalesce(sum((l.x ->> 'qty')::integer), 0)::integer
  from shevatim.reservations r, jsonb_array_elements(r.lines) l(x)
  where r.status = any(p_statuses)
    and l.x ->> 'itemId' = p_item
    and coalesce(l.x ->> 'variantKey', '') = coalesce(p_vkey, '')
    and coalesce((l.x ->> 'held')::boolean, false)
$$;

-- ───────────────────────────── items as JSON ─────────────────────────────
-- the stored item, as it always was
create or replace function shevatim.item_json_base(i shevatim.items) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'code', i.code, 'slug', i.slug, 'category', i.category, 'name', i.name,
    'description', i.description, 'price', i.price, 'variants', i.variants, 'pictures', i.pictures,
    'tribe', i.tribe, 'status', i.status, 'soldOut', i.sold_out, 'cloth', i.cloth, 'sort', i.sort,
    'updatedAt', shevatim.ts(i.updated_at))
$$;

-- the owner's view: the stored item plus, per size, { qty (null = not counted), held, sold }
create or replace function shevatim.item_json(i shevatim.items) returns jsonb
language sql stable set search_path = '' as $$
  select shevatim.item_json_base(i) || jsonb_build_object('stock', coalesce((
    select jsonb_object_agg(k.key, jsonb_build_object(
      'qty', shevatim.stock_of(i.id, k.key),
      'held', shevatim.stock_held(i.id, k.key, array['new', 'contacted', 'confirmed', 'paid', 'ready']),
      'sold', shevatim.stock_held(i.id, k.key, array['done'])))
    from (select v.x ->> 'key' as key from jsonb_array_elements(i.variants) v(x)
          union all
          select '' where jsonb_array_length(i.variants) = 0) k), '{}'::jsonb))
$$;

-- the shop's view: sizes with nothing left are unavailable; small counts are given as "left"
create or replace function shevatim.item_public_json(i shevatim.items) returns jsonb
language sql stable set search_path = '' as $$
  with v as (
    select x.v as raw, x.n, shevatim.stock_of(i.id, x.v ->> 'key') as qty
    from jsonb_array_elements(i.variants) with ordinality x(v, n)
  ), one as (
    select shevatim.stock_of(i.id, '') as qty
  )
  select shevatim.item_json_base(i)
  || case when jsonb_array_length(i.variants) = 0 and (select one.qty from one) <= 10
          then jsonb_build_object('left', (select one.qty from one)) else '{}'::jsonb end
  || jsonb_build_object(
    'variants', coalesce((
      select jsonb_agg(
        v.raw
        || jsonb_build_object('available', coalesce((v.raw ->> 'available')::boolean, false) and (v.qty is null or v.qty > 0))
        || case when v.qty is not null and v.qty <= 10 then jsonb_build_object('left', v.qty) else '{}'::jsonb end
        order by v.n)
      from v), '[]'::jsonb),
    'soldOut',
      i.sold_out
      or (jsonb_array_length(i.variants) > 0
          and exists (select 1 from v where v.qty is not null)
          and not exists (select 1 from v where coalesce((v.raw ->> 'available')::boolean, false) and (v.qty is null or v.qty > 0)))
      or (jsonb_array_length(i.variants) = 0 and coalesce((select one.qty from one), 1) = 0))
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
      select jsonb_agg(case when p_admin then shevatim.item_json(i) else shevatim.item_public_json(i) end
                       order by i.sort, i.code)
      from shevatim.items i where i.status = 'published' or (p_admin and i.status <> 'archived')), '[]'::jsonb),
    'collections', coalesce((
      select jsonb_agg(shevatim.collection_json(c, p_admin) order by c.sort, c.id)
      from shevatim.collections c where c.status = 'published' or p_admin), '[]'::jsonb),
    'settings', shevatim.settings_json());
  return v || jsonb_build_object('version', md5(v::text));
end $$;

-- ───────────────────────────── taking and giving back ─────────────────────────────
-- Takes p_qty of one size if it is counted. Returns true when it took, false when the size is not counted.
-- Not enough left: 'item_unavailable' (the word the shop already understands).
create or replace function shevatim.stock_take(p_item text, p_vkey text, p_qty integer, p_reason text, p_ref text) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_qty integer;
begin
  select s.qty into v_qty from shevatim.stock s
  where s.item_id = p_item and s.variant_key = coalesce(p_vkey, '') for update;
  if not found or v_qty is null then return false; end if;
  if v_qty < p_qty then raise exception 'item_unavailable'; end if;
  update shevatim.stock s set qty = v_qty - p_qty, updated_at = now()
  where s.item_id = p_item and s.variant_key = coalesce(p_vkey, '');
  insert into shevatim.stock_moves (item_id, variant_key, delta, qty_after, reason, ref)
  values (p_item, coalesce(p_vkey, ''), -p_qty, v_qty - p_qty, p_reason, coalesce(p_ref, ''));
  return true;
end $$;

-- Gives p_qty of one size back if it is still counted (a size the owner stopped counting takes nothing back).
create or replace function shevatim.stock_give(p_item text, p_vkey text, p_qty integer, p_reason text, p_ref text) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_qty integer;
begin
  select s.qty into v_qty from shevatim.stock s
  where s.item_id = p_item and s.variant_key = coalesce(p_vkey, '') for update;
  if not found or v_qty is null then return false; end if;
  update shevatim.stock s set qty = v_qty + p_qty, updated_at = now()
  where s.item_id = p_item and s.variant_key = coalesce(p_vkey, '');
  insert into shevatim.stock_moves (item_id, variant_key, delta, qty_after, reason, ref)
  values (p_item, coalesce(p_vkey, ''), p_qty, v_qty + p_qty, p_reason, coalesce(p_ref, ''));
  return true;
end $$;

-- ───────────────────────────── public: reserve (with stock) ─────────────────────────────
create or replace function public.shv_reserve(p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_customer jsonb; v_name text; v_phone text; v_digits text; v_email text; v_note text; v_locale text;
  v_lines jsonb; v_line jsonb; v_out jsonb := '[]'::jsonb; v_held jsonb;
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

  -- rate limits (one reservation at a time, so the counts are exact; stock changes wait for the same lock)
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
      -- counted pieces leave the stock now; not enough left refuses the whole reservation
      v_held := '[]'::jsonb;
      for v_line in select l.x from jsonb_array_elements(v_out) l(x) loop
        v_held := v_held || (v_line || jsonb_build_object('held',
          shevatim.stock_take(v_line ->> 'itemId', v_line ->> 'variantKey', (v_line ->> 'qty')::integer, 'reserve', v_code)));
      end loop;
      update shevatim.reservations r set lines = v_held where r.code = v_code;
      insert into shevatim.rate_events (kind, ip_hash, at) values ('reserve', v_ip, v_now);
      return jsonb_build_object('code', v_code, 'total', v_total);
    exception when unique_violation then
      null; -- same code drawn twice: draw again
    end;
  end loop;
  raise exception 'server_busy';
end $$;

-- ───────────────────────────── back office: reservation status (with stock) ─────────────────────────────
create or replace function shevatim.admin_reservation_update(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_row shevatim.reservations; v_status text; v_note text; v_lines jsonb; v_line jsonb;
begin
  if jsonb_typeof(p -> 'id') is distinct from 'string'
     or (p ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'invalid'; end if;
  if p ? 'status' and not (jsonb_typeof(p -> 'status') = 'string'
       and (p ->> 'status') in ('new', 'contacted', 'confirmed', 'paid', 'ready', 'done', 'cancelled')) then
    raise exception 'invalid'; end if;
  if p ? 'adminNote' and not shevatim.is_str(p -> 'adminNote', 2000) then raise exception 'invalid'; end if;
  if not (p ? 'status') and not (p ? 'adminNote') then raise exception 'invalid'; end if;

  perform pg_advisory_xact_lock(7340101); -- stock moves happen in one order with reservations
  select * into v_row from shevatim.reservations r where r.id = (p ->> 'id')::uuid for update;
  if not found then raise exception 'invalid'; end if;
  v_status := coalesce(p ->> 'status', v_row.status);
  v_note := coalesce(p ->> 'adminNote', v_row.admin_note);

  v_lines := v_row.lines;
  if v_row.status <> 'cancelled' and v_status = 'cancelled' then
    -- cancelled: what it held goes back to the stock
    v_lines := '[]'::jsonb;
    for v_line in select l.x from jsonb_array_elements(v_row.lines) l(x) loop
      if coalesce((v_line ->> 'held')::boolean, false) then
        perform shevatim.stock_give(v_line ->> 'itemId', v_line ->> 'variantKey', (v_line ->> 'qty')::integer, 'release', v_row.code);
      end if;
      v_lines := v_lines || (v_line || '{"held": false}'::jsonb);
    end loop;
  elsif v_row.status = 'cancelled' and v_status <> 'cancelled' then
    -- opened again: its counted pieces are taken again, or it stays cancelled
    v_lines := '[]'::jsonb;
    for v_line in select l.x from jsonb_array_elements(v_row.lines) l(x) loop
      v_lines := v_lines || (v_line || jsonb_build_object('held',
        shevatim.stock_take(v_line ->> 'itemId', v_line ->> 'variantKey', (v_line ->> 'qty')::integer, 'retake', v_row.code)));
    end loop;
  end if;

  update shevatim.reservations r
  set status = v_status, admin_note = v_note, lines = v_lines,
      history = r.history || jsonb_build_object('at', shevatim.ts(now()), 'status', v_status,
                                                'note', coalesce(p ->> 'adminNote', ''))
  where r.id = v_row.id
  returning * into v_row;
  return shevatim.reservation_json(v_row);
end $$;

-- ───────────────────────────── public: back office stock ─────────────────────────────
-- actions: 'stock.set'    { itemId, variantKey ('' for a piece without sizes), qty: 0…100000 | null (stop counting) }
--          'stock.adjust' { itemId, variantKey, delta: ±1…100000 } (an uncounted size starts counting from 0)
--          'stock.moves'  { itemId? } → the last 200 changes, newest first
-- set and adjust answer with the owner's item (the same shape as item.save).
create or replace function public.shv_admin_stock(p_token text, p_action text, p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session text; p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_item shevatim.items; v_vkey text; v_old integer; v_new integer; v_delta integer; v_reason text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'unauthorized'; end if;
  v_session := shevatim.sha(p_token);
  update shevatim.admin_sessions s set expires_at = now() + interval '12 hours'
  where s.token_hash = v_session and s.expires_at > now();
  if not found then raise exception 'unauthorized'; end if;
  if p_action is null or jsonb_typeof(p) <> 'object' or length(p::text) > 20000 then raise exception 'invalid'; end if;

  if p_action = 'stock.moves' then
    if p ? 'itemId' and not shevatim.is_str(p -> 'itemId', 80) then raise exception 'invalid'; end if;
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', shevatim.ts(m.at), 'itemId', m.item_id, 'variantKey', m.variant_key, 'delta', m.delta,
        'qtyAfter', m.qty_after, 'reason', m.reason, 'ref', m.ref) order by m.id desc)
      from (select * from shevatim.stock_moves x
            where not (p ? 'itemId') or x.item_id = p ->> 'itemId'
            order by x.id desc limit 200) m), '[]'::jsonb);
  end if;

  if p_action not in ('stock.set', 'stock.adjust') then raise exception 'invalid'; end if;
  if not shevatim.is_str(p -> 'itemId', 80) or jsonb_typeof(p -> 'variantKey') is distinct from 'string' then
    raise exception 'invalid'; end if;
  select * into v_item from shevatim.items i where i.id = p ->> 'itemId' and i.status <> 'archived';
  if not found then raise exception 'invalid'; end if;
  v_vkey := p ->> 'variantKey';
  if jsonb_array_length(v_item.variants) = 0 then
    if v_vkey <> '' then raise exception 'invalid'; end if;
  elsif not exists (select 1 from jsonb_array_elements(v_item.variants) x(v) where x.v ->> 'key' = v_vkey) then
    raise exception 'invalid';
  end if;

  perform pg_advisory_xact_lock(7340101); -- the reservations' lock: a count never crosses a reservation
  select s.qty into v_old from shevatim.stock s where s.item_id = v_item.id and s.variant_key = v_vkey for update;
  if p_action = 'stock.set' then
    if jsonb_typeof(p -> 'qty') = 'null' then v_new := null;
    elsif shevatim.is_int(p -> 'qty', 0, 100000) then v_new := (p ->> 'qty')::integer;
    else raise exception 'invalid'; end if;
    v_delta := coalesce(v_new, 0) - coalesce(v_old, 0);
    v_reason := 'count';
  else
    if not shevatim.is_int(p -> 'delta', -100000, 100000) or (p ->> 'delta')::integer = 0 then raise exception 'invalid'; end if;
    v_delta := (p ->> 'delta')::integer;
    v_new := coalesce(v_old, 0) + v_delta;
    if v_new < 0 then raise exception 'not_enough'; end if;
    if v_new > 100000 then raise exception 'invalid'; end if;
    v_reason := 'adjust';
  end if;

  insert into shevatim.stock (item_id, variant_key, qty, updated_at)
  values (v_item.id, v_vkey, v_new, now())
  on conflict (item_id, variant_key) do update
    set qty = excluded.qty, updated_at = excluded.updated_at
    where shevatim.stock.item_id = excluded.item_id;
  insert into shevatim.stock_moves (item_id, variant_key, delta, qty_after, reason, ref)
  values (v_item.id, v_vkey, v_delta, v_new, v_reason, '');
  return shevatim.item_json(v_item);
end $$;

-- ───────────────────────────── privileges ─────────────────────────────
revoke all on all functions in schema shevatim from public, anon, authenticated;
grant execute on function shevatim.upload_ticket_ok(text) to anon, authenticated;
revoke all on function public.shv_reserve(jsonb) from public;
revoke all on function public.shv_admin_stock(text, text, jsonb) from public;
grant execute on function public.shv_reserve(jsonb) to anon, authenticated;
grant execute on function public.shv_admin_stock(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
