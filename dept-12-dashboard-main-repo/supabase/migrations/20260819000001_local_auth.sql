-- Local, password-free test-login + permissions layer (D125). Independent of
-- the dormant Supabase Auth/Entra scaffold (D110) — that one needs hosted
-- external services and stays untouched. This is a small, dependency-free
-- roster Nate can log into today: an admin account plus restricted accounts
-- that default to read-only Scheduler until an admin grants more.
create table if not exists app_users (
  id          uuid primary key default gen_random_uuid(),
  username    text not null,
  is_admin    boolean not null default false,
  view_start  date,
  view_end    date,
  created_at  timestamptz not null default now()
);
create unique index if not exists app_users_username_ci_idx on app_users (lower(username));

-- One row per (user, section/sub) the admin has unlocked, with a view/edit
-- level. No grant row = no access at all (except the hardcoded Scheduler
-- read-only baseline every restricted user gets for free). section/sub are
-- loose text, not FKs to a fixed enum, so a new nav section or custom
-- sheet/database never needs a migration to become grantable.
create table if not exists app_user_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  section    text not null,
  sub        text not null,
  can_edit   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, section, sub)
);

alter table app_users       enable row level security;
alter table app_user_grants enable row level security;

create policy app_users_staff_all on app_users
  for all to authenticated using (true) with check (true);
create policy app_user_grants_staff_all on app_user_grants
  for all to authenticated using (true) with check (true);

-- Nate's confirmed test roster: himself as admin, three restricted accounts
-- for verifying a grant to one doesn't leak to another. Idempotent.
insert into app_users (username, is_admin)
values ('Nate', true)
on conflict (lower(username)) do nothing;

insert into app_users (username, is_admin)
values ('Test1', false), ('Test2', false), ('Test3', false)
on conflict (lower(username)) do nothing;
