-- Daybook: run once in Supabase → SQL Editor → New query → paste → Run.
-- Creates one private table for all planner records, a private file bucket, and access rules
-- so each signed-in user can only ever read or change their own data.

create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  coll       text        not null check (coll ~ '^[a-z]{2,20}$'),
  id         text        not null check (char_length(id) between 1 and 200),
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, id)
);

alter table public.records enable row level security;

drop policy if exists "read own records"   on public.records;
drop policy if exists "insert own records" on public.records;
drop policy if exists "update own records" on public.records;
drop policy if exists "delete own records" on public.records;
create policy "read own records"   on public.records for select to authenticated using (auth.uid() = user_id);
create policy "insert own records" on public.records for insert to authenticated with check (auth.uid() = user_id);
create policy "update own records" on public.records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own records" on public.records for delete to authenticated using (auth.uid() = user_id);

-- Live sync between devices
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;

-- Private file storage (receipts, warranties, documents), 20 MB per file
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

drop policy if exists "daybook read own files"   on storage.objects;
drop policy if exists "daybook upload own files" on storage.objects;
drop policy if exists "daybook update own files" on storage.objects;
drop policy if exists "daybook delete own files" on storage.objects;
create policy "daybook read own files"   on storage.objects for select to authenticated using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "daybook upload own files" on storage.objects for insert to authenticated with check (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "daybook update own files" on storage.objects for update to authenticated using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "daybook delete own files" on storage.objects for delete to authenticated using (bucket_id = 'files' and (storage.foldername(name))[1] = auth.uid()::text);
