-- D66: an empty/text cell can carry a category color too (spreadsheet-style
-- fill), not just load chips. schedule_notes is the per-cell record for
-- non-load cells, so the color lives there.
alter table schedule_notes add column category_id uuid references categories(id) on delete set null;
