-- RU Asset View production schema. Apply in the OWNER'S Supabase project; do not use service-role keys in browser.
create extension if not exists pgcrypto;
create table if not exists public.ru_asset_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','editor','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.ru_assets (
  key text primary key check (key ~ '^r[0-9]+$'),
  asset_name text not null default '',
  asset_no text not null default '',
  asset_no_alt text not null default '',
  barcode text not null default '',
  serial_no text not null default '',
  category text not null default '',
  location text not null default '',
  condition text not null default '',
  status text not null default '',
  acquired_date_be text not null default '',
  fiscal_year text not null default '',
  assignee text not null default '',
  ru_photo_id text not null default '',
  ru_photo_thumb text not null default '',
  ru_photo_url text not null default '',
  ru_photo_removed text not null default '',
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create or replace function public.ru_asset_touch() returns trigger language plpgsql as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ru_asset_touch on public.ru_assets;
create trigger ru_asset_touch before update on public.ru_assets
for each row execute function public.ru_asset_touch();
create or replace function public.ru_asset_role() returns text language sql stable security definer
set search_path=public as $$ select role from public.ru_asset_members where user_id=auth.uid() $$;
revoke all on function public.ru_asset_role() from public;
grant execute on function public.ru_asset_role() to authenticated;
alter table public.ru_assets enable row level security;
alter table public.ru_asset_members enable row level security;
grant usage on schema public to authenticated;
grant select,insert,update on public.ru_assets to authenticated;
grant select on public.ru_asset_members to authenticated;
drop policy if exists ru_asset_members_self on public.ru_asset_members;
create policy ru_asset_members_self on public.ru_asset_members for select to authenticated using (user_id=auth.uid());
drop policy if exists ru_asset_select on public.ru_assets;
create policy ru_asset_select on public.ru_assets for select to authenticated
using (public.ru_asset_role() in ('viewer','editor','admin'));
drop policy if exists ru_asset_insert on public.ru_assets;
create policy ru_asset_insert on public.ru_assets for insert to authenticated
with check (public.ru_asset_role() in ('editor','admin'));
drop policy if exists ru_asset_update on public.ru_assets;
create policy ru_asset_update on public.ru_assets for update to authenticated
using (public.ru_asset_role() in ('editor','admin'))
with check (public.ru_asset_role() in ('editor','admin'));
-- No hard delete from browser. Soft delete with deleted_at.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('ru-asset-photos','ru-asset-photos',false,4000000,array['image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=4000000,allowed_mime_types=array['image/jpeg'];
drop policy if exists ru_photo_read on storage.objects;
create policy ru_photo_read on storage.objects for select to authenticated
using (bucket_id='ru-asset-photos' and public.ru_asset_role() in ('viewer','editor','admin'));
drop policy if exists ru_photo_insert on storage.objects;
create policy ru_photo_insert on storage.objects for insert to authenticated
with check (bucket_id='ru-asset-photos' and public.ru_asset_role() in ('editor','admin') and name ~ '^r[0-9]+/[a-f0-9-]+\.jpg$');
drop policy if exists ru_photo_delete on storage.objects;
create policy ru_photo_delete on storage.objects for delete to authenticated
using (bucket_id='ru-asset-photos' and public.ru_asset_role() in ('editor','admin'));
-- Owner must grant membership to an existing auth user:
-- insert into public.ru_asset_members(user_id,role) values ('<AUTH_USER_UUID>','admin');
