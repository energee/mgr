# Audit exports

Row exports taken immediately before a destructive migration drops a
data-bearing table (the in-migration empty-guards force export-then-delete).

Conventions:

- Name: `YYYY-MM-DD-<table>-rows.sql` (date = export date).
- Content: a short provenance header (what dropped the table, tracking
  issue/PR, how to restore) followed by bare `INSERT` statements — no pg_dump
  envelope, so the file replays on any psql version.
- One file per table per event; never edit an existing export.
