/**
 * Create-mode cleanup + tab deep-linking tests (audit finding 33):
 * - resolveInitialTab honors a valid ?tab= param and falls back to "details"
 * - buildPostCreateRedirect appends ?tab= only for opted-in entities, and
 *   the order opt-in targets a relation tab that actually exists
 * - order/purchase-order sections that are meaningless before the first
 *   save (quick links, QBO sync, revision history, ...) set hideOnCreate
 */

import { describe, it, expect, vi } from "vitest";

// Prevents env-var validation in @/lib/env from throwing at import time
// (revision-history.tsx calls createClient() at module scope).
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({})),
}));

// Prevents @sentry/nextjs initialisation errors in jsdom
vi.mock("@/lib/client-logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  resolveInitialTab,
  buildPostCreateRedirect,
} from "@/components/universal/entity-detail-unified";
import { orderEntity } from "@/entities/order";
import { purchaseOrderEntity } from "@/entities/purchase-order";

// ---------------------------------------------------------------------------
// resolveInitialTab
// ---------------------------------------------------------------------------

describe("resolveInitialTab", () => {
  const validTabs = ["Brew Day", "order_items", "pick_lists"];

  it("selects a section tab named by ?tab=", () => {
    expect(resolveInitialTab("Brew Day", validTabs)).toBe("Brew Day");
  });

  it("selects a relation tab named by ?tab=", () => {
    expect(resolveInitialTab("order_items", validTabs)).toBe("order_items");
  });

  it("falls back to details when ?tab= is absent", () => {
    expect(resolveInitialTab(null, validTabs)).toBe("details");
  });

  it("falls back to details for unknown values (stale deep links)", () => {
    expect(resolveInitialTab("nonexistent", validTabs)).toBe("details");
    expect(resolveInitialTab("", validTabs)).toBe("details");
  });

  it("treats an explicit ?tab=details as details", () => {
    expect(resolveInitialTab("details", validTabs)).toBe("details");
  });
});

// ---------------------------------------------------------------------------
// buildPostCreateRedirect
// ---------------------------------------------------------------------------

describe("buildPostCreateRedirect", () => {
  it("deep-links new orders to the Items tab", () => {
    expect(buildPostCreateRedirect("order", "/sales/orders", "abc")).toBe(
      "/sales/orders/abc?tab=order_items"
    );
  });

  it("returns the plain detail path for entities without an opt-in", () => {
    expect(
      buildPostCreateRedirect("purchase_order", "/purchasing/pos", "abc")
    ).toBe("/purchasing/pos/abc");
    expect(buildPostCreateRedirect("batch", "/production/batches", "b1")).toBe(
      "/production/batches/b1"
    );
  });

  it("order opt-in targets a real, visible hasMany relation tab", () => {
    // The redirect tab value must match a tab the detail page actually
    // renders (relation tabs use the relation name as the tab value).
    const rel = orderEntity.relations?.find((r) => r.name === "order_items");
    expect(rel).toBeDefined();
    expect(rel?.type).toBe("hasMany");
    expect(rel?.showInDetail).toBe(true);
    expect(rel?.detailTab).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// hideOnCreate on order / purchase-order sections
// ---------------------------------------------------------------------------

describe("create-mode section visibility (hideOnCreate)", () => {
  const hiddenOrderSections = [
    "quick-links",
    "shipping-materials",
    "change-requests",
    "qbo-sync",
    "revision-history",
  ];

  it.each(hiddenOrderSections)(
    "order section %s is hidden in create mode",
    (sectionId) => {
      const section = orderEntity.sections?.find((s) => s.id === sectionId);
      expect(section).toBeDefined();
      expect(section?.hideOnCreate).toBe(true);
    }
  );

  it("order form sections stay visible in create mode", () => {
    for (const id of ["overview", "notes"]) {
      const section = orderEntity.sections?.find((s) => s.id === id);
      expect(section).toBeDefined();
      expect(section?.hideOnCreate).toBeFalsy();
    }
  });

  it.each(["qbo-sync", "revision-history"])(
    "purchase order section %s is hidden in create mode",
    (sectionId) => {
      const section = purchaseOrderEntity.sections?.find(
        (s) => s.id === sectionId
      );
      expect(section).toBeDefined();
      expect(section?.hideOnCreate).toBe(true);
    }
  );

  it("purchase order form sections stay visible in create mode", () => {
    for (const id of ["overview", "costs", "notes"]) {
      const section = purchaseOrderEntity.sections?.find((s) => s.id === id);
      expect(section).toBeDefined();
      expect(section?.hideOnCreate).toBeFalsy();
    }
  });
});
