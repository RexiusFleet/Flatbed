-- Approved-logins list: a database-side lock that works even when the
-- project's "Allow new users to sign up" setting can't be turned off.
--
-- Any signed-in account whose email is NOT in dept12_private.allowed_logins
-- is refused on every Data API request (tables, api_* functions, and the two
-- Edge Functions, which call the Data API as the user) and on every
-- document in Storage. anon (no login) already has no access at all.
--
-- Add the shared team login after creating it (SETUP.md):
--   insert into dept12_private.allowed_logins (email) values ('dispatch@example.com');
--
-- TODO(AUTH): real per-person auth maps logins to app_users instead; this
-- list can then become that mapping.

create schema if not exists dept12_private;
revoke all on schema dept12_private from public, anon, authenticated;

create table if not exists dept12_private.allowed_logins (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);
revoke all on dept12_private.allowed_logins from public, anon, authenticated;

create or replace function dept12_login_allowed() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case coalesce(auth.jwt() ->> 'role', '')
    when 'service_role' then true
    when 'authenticated' then exists (
      select 1 from dept12_private.allowed_logins
      where email = lower(coalesce(auth.jwt() ->> 'email', '')))
    else false
  end
$$;
revoke execute on function dept12_login_allowed() from public, anon;
grant execute on function dept12_login_allowed() to authenticated;

-- Runs before every Data API request.
create or replace function dept12_check_request() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and not dept12_login_allowed() then
    raise sqlstate 'PGRST' using
      message = json_build_object('message', 'This login is not approved for the Dept 12 dashboard.')::text,
      detail = json_build_object('status', 403)::text;
  end if;
end $$;
grant execute on function dept12_check_request() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.dept12_check_request';
notify pgrst, 'reload config';

-- Storage isn't covered by the pre-request hook; gate the bucket policy too.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'storage' and table_name = 'objects') then
    drop policy if exists dept12_documents_staff_all on storage.objects;
    create policy dept12_documents_staff_all on storage.objects
      for all to authenticated
      using (bucket_id = 'documents' and public.dept12_login_allowed())
      with check (bucket_id = 'documents' and public.dept12_login_allowed());
  end if;
end $$;
