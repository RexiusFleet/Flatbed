-- D190: driver_receipt_completions was added after D131's one-time history
-- trigger sweep. Give the new mutable completion ledger the same durable audit
-- coverage as every other application table.

create trigger dept12_history_capture
  after insert or update or delete on driver_receipt_completions
  for each row execute function dept12_capture_history('order_id');
