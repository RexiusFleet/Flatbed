-- Outside-carrier lane placement no longer requires a carrier name up front
-- (Nate: drag first, name/cost later from a collapsible drawer section,
-- D122) — is_carrier marks "this load sits on the carrier lane" independent
-- of whether carrier_party_id has been filled in yet, since that can now be
-- null immediately after a drop.
alter table loads add column if not exists is_carrier boolean not null default false;
update loads set is_carrier = true where carrier_party_id is not null;
