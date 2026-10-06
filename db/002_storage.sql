-- Shevatim shop: picture storage. SUPABASE ONLY (needs the storage schema); run after 001_schema.sql.
-- Idempotent. The local dev server (scripts/dev-db.mjs) imitates this with files on disk.

-- public bucket: anybody may read, 6 MB per file, pictures only
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shevatim-media', 'shevatim-media', true, 6291456, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The browser uploads with the public key (role anon). The only thing it may do is INSERT an object at
-- u/<ticket>/<file> while <ticket> is a live upload ticket handed out by shv_admin('upload.ticket').
-- No update, no delete, no listing: there are no other policies for this bucket.
drop policy if exists "shevatim upload with ticket" on storage.objects;
create policy "shevatim upload with ticket" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'shevatim-media'
    and array_length(storage.foldername(name), 1) = 2
    and (storage.foldername(name))[1] = 'u'
    and shevatim.upload_ticket_ok((storage.foldername(name))[2])
  );
