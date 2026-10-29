-- Production hardening applied to project rxulhozzrmylcejnrdcm after base schema.
-- Existing RU Asset tables are private to approved signed-in staff. No anonymous data access.
drop policy if exists ru_asset_select on public.ru_assets;
drop policy if exists ru_asset_insert on public.ru_assets;
drop policy if exists ru_asset_update on public.ru_assets;
drop policy if exists ru_photo_read on storage.objects;
drop policy if exists ru_photo_insert on storage.objects;
drop policy if exists ru_photo_delete on storage.objects;
create policy ru_asset_select on public.ru_assets for select to authenticated
using (exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('viewer','editor','admin')));
create policy ru_asset_insert on public.ru_assets for insert to authenticated
with check (exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('editor','admin')));
create policy ru_asset_update on public.ru_assets for update to authenticated
using (exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('editor','admin')))
with check (exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('editor','admin')));
create policy ru_photo_read on storage.objects for select to authenticated
using (bucket_id='ru-asset-photos' and exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('viewer','editor','admin')));
create policy ru_photo_insert on storage.objects for insert to authenticated
with check (bucket_id='ru-asset-photos' and name ~ '^r[0-9]+/[a-f0-9-]+[.]jpg$' and exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('editor','admin')));
create policy ru_photo_delete on storage.objects for delete to authenticated
using (bucket_id='ru-asset-photos' and exists (select 1 from public.ru_asset_members m where m.user_id=(select auth.uid()) and m.role in ('editor','admin')));
drop function if exists public.ru_asset_role();
alter function public.ru_asset_touch() set search_path=pg_catalog,public;
create schema if not exists private;
revoke all on schema private from public;
create or replace function private.ru_confirm_owner()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,auth as $$
begin
 if lower(coalesce(new.email,''))='pakonkook@gmail.com' and new.email_confirmed_at is not null then
   insert into public.ru_asset_members(user_id,role) values(new.id,'admin')
   on conflict (user_id) do update set role=excluded.role;
 end if;
 return new;
end $$;
revoke all on function private.ru_confirm_owner() from public;
drop trigger if exists ru_confirm_owner on auth.users;
create trigger ru_confirm_owner after insert or update of email_confirmed_at on auth.users
for each row execute function private.ru_confirm_owner();
