-- Generic driver delivery-receipt workflow.
-- The first portal deployment is East Side-only, but its unsigned receipt and
-- signed POD use the same permanent order documents as any future rollout.

alter type document_kind add value if not exists 'delivery_receipt';

create table driver_receipt_completions (
  order_id           uuid primary key references orders(id) on delete restrict,
  source_document_id uuid not null references documents(id) on delete restrict,
  pod_document_id    uuid not null unique references documents(id) on delete restrict,
  truck_id           uuid references trucks(id) on delete set null,
  truck_number       text not null,
  driver_note        text,
  completed_at       timestamptz not null default now()
);

create index driver_receipt_completions_completed_idx
  on driver_receipt_completions (completed_at desc);

alter table driver_receipt_completions enable row level security;

create policy driver_receipt_completions_authenticated_all
  on driver_receipt_completions for all to authenticated
  using (true) with check (true);

comment on table driver_receipt_completions is
  'Generic driver-receipt completion ledger; portal scope can change without changing documents or workflow.';
