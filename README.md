# Shevatim shop

The Shevatim (שבטים) online store, built by Halom studio: Hebrew, English and French; reservations (nothing is
charged); twelve tribes, five pieces each per collection; a back office at `/admin/`.

- Next.js 16 static export (`npm run build` writes `out/`). Hosting: Vercel, preset Next.js, repository root.
- Backend: SQL functions on Supabase, called from the browser (`lib/api.ts`). Setup and the order of the SQL
  files: `db/README.md`.
- Build variables (public by design): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_KEY` (the publishable
  key), `NEXT_PUBLIC_SITE_URL` (the public address, for share previews).
- Locally: `npm install`, `npm run db` (a local database on port 54321, password `shevatim-dev-password`),
  `npm run dev`. Checks: `npm run typecheck`, `npm test`.
- What the shop is and how it is put together: `docs/CONTRACT.md`. The look: `docs/DESIGN.md`.
  Where the tribes' verses come from: `docs/tribes-sources.md`.

The build history up to 6 Oct 2026 is on the `shevatim` branch of `danieltinker/halom-models`.
