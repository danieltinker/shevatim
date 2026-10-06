# Shevatim shop — database

The site is static. All server logic is SQL, called by the browser through PostgREST
(`POST {url}/rest/v1/rpc/<function>`). `lib/api.ts` is the only caller.

## Files
| File | What it is |
|---|---|
| `001_schema.sql` | Private schema `shevatim` (tables, row level security on, no policies) and the four public functions `shv_catalog`, `shv_reserve`, `shv_admin_login`, `shv_admin`. Idempotent. |
| `002_storage.sql` | Supabase only: the public bucket `shevatim-media` and the one upload policy (insert with a live ticket). Idempotent. |
| `003_seed.sql` | Generated. One `shevatim.load_seed(...)` call with `seed.json` inside. Only adds what is missing, never overwrites. |
| `seed.json` | The launch catalogue (the lead's file). |
| `seed.mjs` | `node db/seed.mjs` rewrites `003_seed.sql` from `seed.json`. Run it and commit whenever `seed.json` changes. |

## On Supabase (SQL editor, as `postgres`), in this order
1. `001_schema.sql`
2. `002_storage.sql`
3. `003_seed.sql`
4. Two one-off statements (put your own values):
   ```sql
   select shevatim.set_admin_password('a long password, 10+ characters');
   select shevatim.set_setting('storagePublicBase', '"https://<ref>.supabase.co/storage/v1/object/public/shevatim-media"');
   ```
   (`set_setting` takes JSON, so a text value keeps its double quotes inside the single quotes.)

Then give the site `NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co` and `NEXT_PUBLIC_SUPABASE_KEY=<publishable key>`.
All three files can be run again at any time (after a change to `001`, just run `001` again).
`set_admin_password` also ends every open back-office session.

## Locally
```bash
npm run db                                   # http://localhost:54321, in memory, password "shevatim-dev-password"
PORT=54400 ADMIN_PASSWORD='something long' npm run db
DATA_DIR=.data/db npm run db                 # keeps the database and uploaded pictures between runs
RATE_LIMITS=on npm run db                    # keep the real rate limits (off by default locally, see below)
npm test                                     # the SQL on an in-memory Postgres + the dev server over HTTP
```
`scripts/dev-db.mjs` runs `001_schema.sql` and the seed (built from `seed.json` on the spot) on pglite and serves the
same URLs as Supabase: `/rest/v1/rpc/<fn>`, `/storage/v1/object/shevatim-media/...` (upload) and
`/storage/v1/object/public/shevatim-media/...` (read).
Locally the rate limits are switched off unless `RATE_LIMITS=on` (the dev server clears the rate events after each
call), so repeated test reservations and logins from one machine are never answered with `too_many`.
With `DATA_DIR` set, the admin password is only (re)set when `ADMIN_PASSWORD` is given or no password exists yet.

## Things worth knowing
- Errors are `raise exception '<code>'` (SQLSTATE P0001) → HTTP 400 `{"message":"<code>"}`.
  One exception: a wrong login password returns normally with PostgREST's `response.status` set to 400 and the body
  `{"message":"bad_password"}`. A raised error would roll back the failed-attempt record the rate limit needs.
  The browser cannot tell the difference.
- Client addresses are never stored, only `sha256(salt | address)`; the salt is made once (`settings.ipSalt`).
- Limits: 6 reservations per hour per address and 300 per day in total; 8 wrong passwords per 15 minutes per
  address and 40 in total. Sessions last 12 hours from the last call.
- New items get a code from the first two letters of the category key plus the next number (`sh01`, `tz33`);
  the id equals that code and the slug is `<english-name>-<code>`. Renaming never changes the slug.
- `collection.save` ignores `slots`; use `collection.slots` (one tribe at a time).
- Private settings rows (`ipSalt`, `storagePublicBase`) never appear in the catalogue.

## After any change to the functions on Supabase
Check that the browser may still call the four public functions, and grant again if not (seen on 6 Oct 2026: the
grants written inside a migration were gone afterwards, while the same grants run on their own stayed):
```sql
select proname, has_function_privilege('anon', oid, 'execute') from pg_proc where proname like 'shv\_%';
grant execute on function public.shv_catalog(), public.shv_reserve(jsonb),
  public.shv_admin_login(text), public.shv_admin(text, text, jsonb) to anon, authenticated;
```
The site sends the publishable key (`sb_publishable_…`) on the `apikey` header only.
