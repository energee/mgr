/**
 * E2E tests for the customer order flow — F114 verification surface.
 *
 * Smoke level: the internal sales/orders pages and the portal login. Full
 * flow: seeds a `draft` order with one line item plus an in-stock finished
 * goods lot via e2e/seed.ts (service role), then drives
 * confirm -> allocate (FIFO) -> schedule -> pick -> pack -> fulfil and asserts
 * the order status and the allocation lifecycle DB-side.
 *
 * ## Why this is not "place order through portal -> allocate -> fulfill"
 *
 * The scaffold this replaces described a portal order-placement flow that
 * does not exist in the product. `src/app/portal/` has exactly four routes —
 * login, orders list, order detail, and order-detail change-request — and no
 * create path; the orders list's own empty state reads "Once your brewery
 * places an order on your behalf, it will appear here." Orders are placed by
 * staff, by design (the portal is invite-only and staff-confirm-everything).
 *
 * So the portal legs of that scaffold (steps 1-3 and 8) are not "not yet
 * automated", they are unbuildable until someone builds portal ordering, and
 * they stay tracked below rather than being silently dropped. What IS the real
 * multi-step workflow — the staff-side allocate-and-fulfil chain, steps 4-7 —
 * is implemented here.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSeedClient,
  cleanupOrderFixtures,
  seedOrderFixtures,
  ORDER_IDS,
  ORDER_NUMBER,
  ORDER_QUANTITY,
  ORDER_LOT_QUANTITY,
  ORDER_CONTAINER_VOLUME_OZ,
  ORDER_FORMAT_UNIT_COUNT,
  OZ_PER_BBL,
  type OrderFixture,
} from "./seed";
import { clickUnderToasts } from "./ui";

test.describe("Customer order — internal", () => {
  test("orders list renders", async ({ page }) => {
    await page.goto("/sales/orders");
    await expect(
      page.getByRole("heading", { name: /orders/i }),
    ).toBeVisible();
  });

  test("new order page renders", async ({ page }) => {
    await page.goto("/sales/orders/new");
    await expect(page.locator("body")).toContainText(/order/i);
  });
});

test.describe("Customer order — portal", () => {
  test("portal login renders without auth", async ({ browser }) => {
    // Portal login is the only page reachable without an authenticated session.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto("/portal/login");
    await expect(page.locator("body")).toContainText(/sign in|login|portal/i);
    await context.close();
  });

  // SKIPPED — still blocked on the PRODUCT, tracked in #706 (and #437).
  // This used to list two blockers. The second — no way to hold an
  // authenticated portal session, because portal auth is OTP/magic-link only
  // (`shouldCreateUser: false`, portal-login-form.tsx) — is now solved:
  // `e2e/portal-auth.setup.ts` logs in over a real OTP read from the local
  // mail catcher and the `chromium-portal` project consumes that state (see
  // e2e/portal-orders.spec.ts for authenticated portal coverage).
  // What remains is blocker 1: there is no portal order-placement UI to drive
  // (see this file's header). That is a missing feature, not a missing test,
  // and it must be resolved product-side before this is worth writing.
  test.skip("customer places an order through the portal", async () => {
    // Requires: portal order-placement UI (does not exist). The portal
    // storageState this would run under already exists — see above.
  });
});

// Single-test describe: with fullyParallel only one worker ever runs these
// hooks, so the delete-and-recreate seeding cannot race itself (e2e/seed.ts).
test.describe("Customer order — full flow", () => {
  // Six sequential transitions plus an allocation dialog; see the equivalent
  // note in packaging-session.spec.ts for why the default budget is too tight.
  test.slow();

  let seed: SupabaseClient;
  let fixture: OrderFixture;

  test.beforeAll(async () => {
    seed = createSeedClient();
    await cleanupOrderFixtures(seed); // reset leftovers from a crashed run
    fixture = await seedOrderFixtures(seed);
  });

  test.afterAll(async () => {
    if (!seed) return; // beforeAll failed before the client existed
    await cleanupOrderFixtures(seed);
  });

  test("confirm, allocate, and fulfil an order", async ({ page }) => {
    // Step 1: draft -> confirmed. Order transitions are named actions
    // rendered as buttons (entities/order/presentation.tsx), not dropdown
    // items, so each one is clicked directly.
    await page.goto(`/sales/orders/${ORDER_IDS.order}`);
    await expect(
      page.getByRole("heading", { name: ORDER_NUMBER }),
    ).toBeVisible({ timeout: 30_000 });
    // Every transition below goes through clickUnderToasts: the toasts these
    // fire stack over the very buttons the next step needs (see e2e/ui.ts).
    await clickUnderToasts(page.getByRole("button", { name: "Confirm Order" }));
    await expect(
      page.getByRole("button", { name: "Schedule Delivery" }),
    ).toBeVisible({ timeout: 30_000 });

    // Step 2: allocate finished goods. "Auto-allocate (FIFO)" fills each line
    // up to its remaining demand, so the dialog's own math decides the
    // quantity — the button label carries the total it is about to write.
    await page.goto(`/sales/orders/${ORDER_IDS.order}/allocations`);
    await page.getByRole("button", { name: "Add Allocation" }).first().click();
    const allocDialog = page.getByRole("dialog", {
      name: /allocate inventory/i,
    });
    await expect(allocDialog).toBeVisible();
    const autoAllocate = allocDialog.getByRole("button", {
      name: "Auto-allocate (FIFO)",
    });
    await expect(autoAllocate).toBeEnabled({ timeout: 30_000 });
    await autoAllocate.click();
    // FIFO fills to the line's remaining demand — ORDER_QUANTITY, not the
    // lot's full ORDER_LOT_QUANTITY. Asserting the exact label proves the
    // demand math ran, not merely that a button was clicked.
    await allocDialog
      .getByRole("button", { name: `Allocate (${ORDER_QUANTITY})` })
      .click();
    await expect(allocDialog).not.toBeVisible({ timeout: 30_000 });

    // The reservation exists and is `planned` until fulfilment completes it.
    // Captured by id so the post-fulfilment assertion can key on THIS run's
    // row (completed allocations survive cleanup — see e2e/seed.ts).
    const { data: planned } = await seed
      .from("allocations")
      .select("id, quantity, status, source_type, destination_type")
      .eq("destination_id", ORDER_IDS.order)
      .eq("source_id", fixture.finishedGoodId);
    expect(planned).toHaveLength(1);
    expect(planned![0].status).toBe("planned");
    expect(planned![0].quantity).toBe(ORDER_QUANTITY);
    expect(planned![0].source_type).toBe("finished_good");
    expect(planned![0].destination_type).toBe("order");
    const allocationId = planned![0].id as string;

    // Reserving reduces availability without changing the lot's quantity.
    const { data: availability } = await seed
      .from("finished_goods_with_availability")
      .select("quantity, available_quantity")
      .eq("id", fixture.finishedGoodId)
      .single();
    expect(availability!.quantity).toBe(ORDER_LOT_QUANTITY);
    expect(Number(availability!.available_quantity)).toBe(
      ORDER_LOT_QUANTITY - ORDER_QUANTITY,
    );

    // Step 3: confirmed -> scheduled. This one collects a delivery date in a
    // pre-transition dialog (transitionFields), which defaults to the order's
    // requested_date — seeded, so the field is already valid.
    await page.goto(`/sales/orders/${ORDER_IDS.order}`);
    await clickUnderToasts(
      page.getByRole("button", { name: "Schedule Delivery" }),
    );
    const scheduleDialog = page.getByRole("dialog", {
      name: /schedule delivery/i,
    });
    await expect(scheduleDialog).toBeVisible();
    await scheduleDialog
      .getByRole("button", { name: "Schedule Delivery" })
      .click();

    // Step 4: scheduled -> picking -> packed -> fulfilled.
    for (const label of ["Start Picking", "Mark Packed", "Mark Fulfilled"]) {
      await clickUnderToasts(page.getByRole("button", { name: label }));
    }

    // Step 5: DB-side effects. Fulfilment is handled by
    // transition_entity_atomic, which completes the order's planned
    // finished-goods reservations and stamps volume_bbl on them — server-side
    // work the browser never sees, so the DB is the only honest source.
    await expect
      .poll(
        async () => {
          const { data } = await seed
            .from("orders")
            .select("status")
            .eq("id", ORDER_IDS.order)
            .single();
          return data?.status;
        },
        { timeout: 30_000 },
      )
      .toBe("fulfilled");

    const { data: fulfilledOrder } = await seed
      .from("orders")
      .select("status, scheduled_date, fulfilled_date")
      .eq("id", ORDER_IDS.order)
      .single();
    // set_order_fulfilled_date stamps this on the status flip.
    expect(fulfilledOrder!.fulfilled_date).not.toBeNull();
    expect(fulfilledOrder!.scheduled_date).not.toBeNull();

    const { data: completedAlloc } = await seed
      .from("allocations")
      .select("status, quantity, volume_bbl, completed_at")
      .eq("id", allocationId)
      .single();
    expect(completedAlloc!.status).toBe("completed");
    expect(completedAlloc!.completed_at).not.toBeNull();
    // volume_bbl is derived server-side from the format, not copied from the
    // allocation: quantity x unit_count x container volume. Asserting it
    // proves the join actually resolved — a null container or unit_count
    // would leave this null rather than merely inaccurate.
    const expectedVolumeBbl =
      (ORDER_QUANTITY * ORDER_FORMAT_UNIT_COUNT * ORDER_CONTAINER_VOLUME_OZ) /
      OZ_PER_BBL;
    // Precision 4: allocations.volume_bbl is numeric(10,4), so the stored
    // value is the exact quotient rounded to four decimals (0.1613, not
    // 0.16129032…). Asserting tighter than the column's own scale would fail
    // on a correct value.
    expect(Number(completedAlloc!.volume_bbl)).toBeCloseTo(expectedVolumeBbl, 4);
  });
});
