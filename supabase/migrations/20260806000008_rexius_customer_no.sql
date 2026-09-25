-- ============================================================================
-- Rexius Customer Number on parties (D46). Nate: the unique account identifier
-- in the accounting system — "so i can quickly find them … to make an invoice."
-- Free text (accounting numbers vary in shape); not enforced unique so a
-- half-entered record never blocks a save.
-- ============================================================================

alter table parties add column rexius_customer_no text;

comment on column parties.rexius_customer_no is
  'Accounting-system account number for this customer/broker (Rexius Customer Number). Free text.';
