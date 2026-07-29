-- Attachments on the console, and room for real files.
--
-- Paste into the Supabase SQL editor and run. Safe to run twice.

-- ---------------------------------------------------------------- what a note is
-- A brand note is not one thing. A color, a typeface, a rule and a logo file all
-- belong on the brand face and none of them render the same way. Inferring the kind
-- from which columns happen to be filled works until two of them are filled at once,
-- so the row says what it is.
alter table project_notes add column if not exists facet text;

-- 'color' | 'type' | 'rule' | 'asset'  on brand
-- null on inspiration and requests, which are uniform
alter table project_notes drop constraint if exists project_notes_facet_check;
alter table project_notes add constraint project_notes_facet_check
  check (facet is null or facet in ('color', 'type', 'rule', 'asset'));

-- ------------------------------------------------------------------ real files
-- The bucket only accepted images, which made "files" a promise it could not keep.
-- A brief is a PDF, a logo is an SVG, a font is a file. Still capped, still typed:
-- an open bucket is a hosting service someone else eventually finds.
update storage.buckets
set file_size_limit = 26214400,   -- 25 MB
    allowed_mime_types = array[
      'image/png','image/jpeg','image/webp','image/gif','image/svg+xml',
      'application/pdf','application/zip',
      'font/woff','font/woff2','font/ttf','font/otf',
      'text/plain','text/csv'
    ]
where id = 'shots';

-- ------------------------------------------------------- clients may attach things
-- Until now only staff could write into the bucket, so a client could be asked for a
-- screenshot of what they meant and had nowhere to put it.
--
-- The same path rule governs writing as reading: the first segment is the project id,
-- compared as text and never cast, so a malformed path denies rather than raising.
-- A client can therefore only ever write into their own project's folder.
drop policy if exists shots_client_write on storage.objects;
create policy shots_client_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'shots'
    and (storage.foldername(name))[1] in (select p::text from public.my_project_ids() p)
  );

-- They may also remove what they put there, and nothing else. Ownership is by the
-- uploader, which storage records for us.
drop policy if exists shots_client_delete on storage.objects;
create policy shots_client_delete on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'shots'
    and owner = auth.uid()
    and (storage.foldername(name))[1] in (select p::text from public.my_project_ids() p)
  );
