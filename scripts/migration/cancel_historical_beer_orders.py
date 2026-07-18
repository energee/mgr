#!/usr/bin/env python3
"""Cancel the historical pre-cutover Beer orders.xlsx keg orders (issue #425).

The reconcile_beer_orders.py import intentionally left ~200 historical keg
orders in ``packed`` because their packaging fills/lots were never recorded in
MGR; fulfilling them would fabricate keg inventory transactions. Per the
decision on issue #425 those orders are retained as reference records and
transitioned ``packed`` -> ``cancelled`` — a terminal state excluded from
open-demand/material-planning queries — while every order row, item row, note,
date, price, and keg-owner assignment is preserved untouched.

Candidates are selected with belt-and-suspenders checks:

* PostgREST filter: ``status=packed`` AND ``order_number LIKE 'XLSX-*'`` AND
  ``order_date < --cutover`` (default 2026-07-14, the reconcile run date).
* Python re-check: order_number matches ``^XLSX-\\d{8}-`` AND notes start with
  the exact prefix written by the importer. Rows failing the re-check are
  dropped and reported, never mutated.

Dry-run is the default and only prints the preview (count, histograms, full
id/order_number list). ``--apply`` writes a JSON preimage backup first, then:

1. PATCHes candidate orders to ``cancelled`` (status-guarded, in id-batches).
   The server-side state machine (00205) allows packed -> cancelled, and the
   keg trigger ``on_order_fulfillment_keg_transactions`` (00183) only fires on
   -> fulfilled, so no inventory transactions are created.
2. Mirrors the client-side cancellation side effect from
   src/services/transition-side-effects.ts: releases the orders' still-planned
   finished-goods allocations (planned -> cancelled; idempotent, expected 0).
3. Deletes the high-priority "Order Cancelled" broadcast notifications that
   trigger ``order_status_notification`` (00022) fans out to every user —
   ~200 orders x N users of pure noise for years-old spreadsheet history.
4. Re-selects and verifies: all candidates cancelled, zero packed XLSX orders
   remain, and the candidates' order_items count is unchanged.

Execution against hosted data is a HUMAN action: run the dry-run, review the
IDs and histograms (a count deviating from the expected 200 prints a warning),
then re-run with ``--apply``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

# Written by reconcile_beer_orders.py / src/integrations/beer-orders/planner.ts
# ("Beer orders.xlsx source of truth; sheet <name>").
NOTES_PREFIX = "Beer orders.xlsx source of truth"
ORDER_NUMBER_PATTERN = re.compile(r"^XLSX-\d{8}-")
# Snapshot from issue #425: 200 historical packed orders, 16 current/future
# scheduled orders. Deviations are warnings, not errors — live data may drift.
EXPECTED_CANDIDATES = 200
EXPECTED_REMAINING_SCHEDULED = 16
# Title written by trigger_order_status_notification (00022) on -> cancelled.
CANCELLED_NOTIFICATION_TITLE = "Order Cancelled"
ID_BATCH_SIZE = 40


class SupabaseRest:
    """Minimal PostgREST client (same idiom as reconcile_beer_orders.py)."""

    def __init__(self, url: str, key: str):
        self.base = f"{url.rstrip('/')}/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def request(
        self,
        method: str,
        table: str,
        *,
        query: str = "",
        body: object | None = None,
        prefer: str | None = None,
    ) -> Any:
        url = f"{self.base}/{table}{'?' + query if query else ''}"
        headers = dict(self.headers)
        payload = None
        if body is not None:
            payload = json.dumps(body, separators=(",", ":")).encode()
            headers["Content-Type"] = "application/json"
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request) as response:
                raw = response.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            details = error.read().decode()
            raise RuntimeError(f"{method} {table}: HTTP {error.code}: {details}") from error

    def select(
        self, table: str, columns: str = "*", filters: dict[str, str] | None = None
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        while True:
            params = {
                "select": columns,
                "order": "id",
                "limit": str(page_size),
                "offset": str(len(rows)),
            }
            params.update(filters or {})
            # quote (not quote_plus) so spaces/'+' in filter values are
            # percent-encoded unambiguously for PostgREST.
            query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
            page = self.request("GET", table, query=query) or []
            rows.extend(page)
            if len(page) < page_size:
                return rows

    def select_by_ids(
        self,
        table: str,
        columns: str,
        id_column: str,
        ids: list[str],
        extra: dict[str, str] | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for id_batch in chunks(ids, ID_BATCH_SIZE):
            filters = {id_column: f"in.({','.join(id_batch)})"}
            filters.update(extra or {})
            rows.extend(self.select(table, columns, filters))
        return rows


def load_env(path: Path) -> None:
    """Populate os.environ from a dotenv-style file, if present (never overrides)."""
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def chunks(values: list[Any], size: int = ID_BATCH_SIZE) -> list[list[Any]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Transition historical pre-cutover Beer orders.xlsx orders from "
            "'packed' to 'cancelled', preserving all rows and metadata "
            "(issue #425). Dry-run by default: prints the candidate preview "
            "and exits without mutating anything."
        ),
        epilog=(
            "Execution is a human action: review the dry-run preview "
            "(expected ~%d candidates), then re-run with --apply."
            % EXPECTED_CANDIDATES
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="mutate live data (default: dry-run preview only)",
    )
    parser.add_argument(
        "--env",
        type=Path,
        default=Path(".env"),
        help="dotenv file providing Supabase credentials (default: .env)",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path("/tmp/mgr-beer-orders-backups"),
        help="directory for the --apply preimage backup JSON",
    )
    parser.add_argument(
        "--cutover",
        default="2026-07-14",
        help=(
            "ISO date; only packed XLSX orders dated strictly before this are "
            "cancelled (default: 2026-07-14, the reconcile run date)"
        ),
    )
    args = parser.parse_args()

    cutover = date.fromisoformat(args.cutover)

    load_env(args.env)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    rest = SupabaseRest(url, key)
    raw_candidates = rest.select(
        "orders",
        "*",
        {
            "status": "eq.packed",
            "order_number": "like.XLSX-*",
            "order_date": f"lt.{cutover.isoformat()}",
        },
    )

    # Belt-and-suspenders: only rows that also carry the importer's exact
    # order-number shape AND source-of-truth notes prefix are candidates.
    candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for row in raw_candidates:
        reasons = []
        if not ORDER_NUMBER_PATTERN.match(str(row.get("order_number") or "")):
            reasons.append("order_number does not match ^XLSX-\\d{8}-")
        if not str(row.get("notes") or "").startswith(NOTES_PREFIX):
            reasons.append(f"notes do not start with {NOTES_PREFIX!r}")
        if reasons:
            rejected.append(
                {
                    "id": str(row["id"]),
                    "order_number": row.get("order_number"),
                    "reasons": reasons,
                }
            )
        else:
            candidates.append(row)

    candidate_ids = sorted(str(row["id"]) for row in candidates)
    items = rest.select_by_ids("order_items", "*", "order_id", candidate_ids)
    allocations = rest.select_by_ids(
        "allocations", "*", "destination_id", candidate_ids, extra={"destination_type": "eq.order"}
    )
    pick_lists = rest.select_by_ids("pick_lists", "id,order_id,status", "order_id", candidate_ids)

    # The release step mirrors transition-side-effects.ts exactly: only
    # still-planned finished-goods reservations are cancelled.
    planned_allocations = [
        row
        for row in allocations
        if row.get("status") == "planned" and row.get("source_type") == "finished_good"
    ]
    completed_allocations = [row for row in allocations if row.get("status") == "completed"]

    print(
        json.dumps(
            {
                "mode": "APPLY" if args.apply else "DRY RUN",
                "cutover": cutover.isoformat(),
                "candidates": len(candidates),
                "expected_candidates": EXPECTED_CANDIDATES,
                "rejected_by_secondary_checks": rejected,
                "order_date_histogram": dict(
                    sorted(Counter(str(row.get("order_date")) for row in candidates).items())
                ),
                "order_items_on_candidates": len(items),
                "allocation_status_histogram": Counter(
                    str(row.get("status")) for row in allocations
                ),
                "planned_allocations_to_release": len(planned_allocations),
                "completed_allocations_left_untouched": len(completed_allocations),
                "pick_lists_on_candidates_left_untouched": len(pick_lists),
                "candidate_orders": [
                    {
                        "id": str(row["id"]),
                        "order_number": row.get("order_number"),
                        "order_date": row.get("order_date"),
                    }
                    for row in sorted(candidates, key=lambda row: str(row.get("order_number")))
                ],
            },
            indent=2,
            default=lambda value: dict(value),
        )
    )
    if len(candidates) != EXPECTED_CANDIDATES:
        print(
            f"WARNING: candidate count {len(candidates)} deviates from the expected "
            f"{EXPECTED_CANDIDATES} — review the preview before --apply",
            file=sys.stderr,
        )
    if completed_allocations or pick_lists:
        print(
            f"WARNING: candidates carry {len(completed_allocations)} completed allocation(s) "
            f"and {len(pick_lists)} pick list(s); both are left untouched by design",
            file=sys.stderr,
        )

    if not args.apply:
        return 0
    if not candidates:
        print("No candidates — nothing to apply.")
        return 0

    # (a) Preimage backup before any mutation.
    args.backup_dir.mkdir(parents=True, exist_ok=True)
    run_start = datetime.now(timezone.utc)
    stamp = run_start.strftime("%Y%m%dT%H%M%SZ")
    backup_path = args.backup_dir / f"beer-orders-cancel-preimage-{stamp}.json"
    backup_path.write_text(
        json.dumps(
            {
                "orders": candidates,
                "order_items": items,
                "allocations": allocations,
                "cutover": cutover.isoformat(),
                "created_at": run_start.isoformat(),
            },
            indent=2,
        )
    )
    print(f"Backup: {backup_path}")

    # (b) packed -> cancelled, status-guarded, in id-batches. Allowed by the
    # orders state machine; the keg-shipment trigger only fires on -> fulfilled.
    for id_batch in chunks(candidate_ids):
        query = urllib.parse.urlencode(
            {"id": f"in.({','.join(id_batch)})", "status": "eq.packed"},
            quote_via=urllib.parse.quote,
        )
        rest.request(
            "PATCH", "orders", query=query, body={"status": "cancelled"}, prefer="return=minimal"
        )

    # (c) Release still-planned finished-goods reservations (mirror of the
    # client-side orders -> cancelled side effect; idempotent, expected 0 rows).
    released = 0
    for id_batch in chunks(candidate_ids):
        query = urllib.parse.urlencode(
            {
                "destination_type": "eq.order",
                "destination_id": f"in.({','.join(id_batch)})",
                "source_type": "eq.finished_good",
                "status": "eq.planned",
            },
            quote_via=urllib.parse.quote,
        )
        released += len(
            rest.request(
                "PATCH",
                "allocations",
                query=query,
                body={"status": "cancelled"},
                prefer="return=representation",
            )
            or []
        )
    print(f"Planned finished-goods allocations released: {released}")

    # (d) Drop the per-user "Order Cancelled" broadcast rows this run created.
    deleted = 0
    for id_batch in chunks(candidate_ids):
        query = urllib.parse.urlencode(
            {
                "entity_type": "eq.order",
                "entity_id": f"in.({','.join(id_batch)})",
                "title": f"eq.{CANCELLED_NOTIFICATION_TITLE}",
                "created_at": f"gte.{run_start.isoformat()}",
            },
            quote_via=urllib.parse.quote,
        )
        deleted += len(
            rest.request("DELETE", "notifications", query=query, prefer="return=representation")
            or []
        )
    print(f"Cancellation broadcast notifications removed: {deleted}")

    # (e) Post-apply verification.
    final_candidates = rest.select_by_ids("orders", "id,status", "id", candidate_ids)
    not_cancelled = [row for row in final_candidates if row.get("status") != "cancelled"]
    xlsx_orders = rest.select("orders", "id,order_number,status", {"order_number": "like.XLSX-*"})
    rejected_ids = {row["id"] for row in rejected}
    unexpected_packed = [
        row
        for row in xlsx_orders
        if row.get("status") == "packed" and str(row["id"]) not in rejected_ids
    ]
    final_items = rest.select_by_ids("order_items", "id", "order_id", candidate_ids)
    checks = {
        "candidates_cancelled": len(final_candidates) - len(not_cancelled),
        "candidates_not_cancelled": [str(row["id"]) for row in not_cancelled],
        "xlsx_status_histogram": Counter(str(row.get("status")) for row in xlsx_orders),
        "remaining_packed_xlsx": [str(row["id"]) for row in unexpected_packed],
        "order_items_before": len(items),
        "order_items_after": len(final_items),
    }
    print("Validation:", json.dumps(checks, indent=2, default=lambda value: dict(value)))
    if not_cancelled or unexpected_packed or len(final_items) != len(items):
        raise RuntimeError(f"Post-apply validation failed: {checks}")
    scheduled = Counter(str(row.get("status")) for row in xlsx_orders).get("scheduled", 0)
    if scheduled != EXPECTED_REMAINING_SCHEDULED:
        print(
            f"WARNING: expected {EXPECTED_REMAINING_SCHEDULED} scheduled XLSX orders to remain, "
            f"found {scheduled}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI boundary must fail loudly
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from None
