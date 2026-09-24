-- D67: per-cell formatting for the Sheets-style toolbar. A cell (a load chip or
-- an empty/text note) can carry its own fill color, text color, bold, italic,
-- and font size — hand-applied on the Scheduler / Current Week. Stored as a
-- small jsonb so we don't add five columns; keys present only when set:
--   { "fill": "#RRGGBB", "text": "#RRGGBB", "bold": true, "italic": true, "size": 12 }
-- Internal (bagger) chips still take their color conditionally from the
-- customer's designation; fmt.fill is the manual override used mainly on
-- external loads and empty cells (Nate: "I only change colors on external loads").
alter table loads add column fmt jsonb not null default '{}'::jsonb;
alter table schedule_notes add column fmt jsonb not null default '{}'::jsonb;
