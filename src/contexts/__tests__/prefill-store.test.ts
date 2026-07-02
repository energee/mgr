/**
 * Characterization tests for src/contexts/prefill-store.ts.
 *
 * The store is a plain sessionStorage-backed singleton exposing a zustand-like
 * API (`usePrefillStore((s) => ...)` / `usePrefillStore.getState()`). These
 * tests pin the *current* behavior, including swallowed-error quirks around a
 * corrupt or unavailable `sessionStorage`, rather than asserting an idealized
 * contract. The project's default vitest environment is jsdom, so a real
 * `sessionStorage` is available without any manual stubbing; storage-failure
 * paths are exercised by spying on `Object.getPrototypeOf(sessionStorage)`
 * (jsdom's `sessionStorage` instance is not `=== Storage.prototype`-backed
 * from this test realm, so spying on the global `Storage.prototype` does not
 * intercept calls — spying on the instance's actual prototype does).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { usePrefillStore } from "@/contexts/prefill-store";

const STORAGE_KEY = "mgr-prefill";
const storageProto = Object.getPrototypeOf(sessionStorage) as Storage;

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePrefillStore - empty/initial state", () => {
  it("reports null prefillData and null openDialog when storage is empty", () => {
    const state = usePrefillStore.getState();
    expect(state.prefillData).toBeNull();
    expect(state.openDialog).toBeNull();
  });

  it("getState() exposes setPrefill and consume functions", () => {
    const state = usePrefillStore.getState();
    expect(typeof state.setPrefill).toBe("function");
    expect(typeof state.consume).toBe("function");
  });

  it("getState() returns the same underlying object reference across calls", () => {
    // The module-level `state` singleton is returned as-is (its getters are
    // recomputed on each property access, but the object identity is stable).
    expect(usePrefillStore.getState()).toBe(usePrefillStore.getState());
  });
});

describe("setPrefill / consume round trip", () => {
  it("stores data and consume() returns it, then clears it", () => {
    const data = { orderId: "abc-123", qty: 4 };
    usePrefillStore.getState().setPrefill(data);

    expect(usePrefillStore.getState().prefillData).toEqual(data);
    expect(usePrefillStore.getState().openDialog).toBeNull();

    const consumed = usePrefillStore.getState().consume();
    expect(consumed).toEqual({ prefillData: data, openDialog: null });

    // Second read after consume is empty.
    expect(usePrefillStore.getState().prefillData).toBeNull();
    expect(usePrefillStore.getState().openDialog).toBeNull();
  });

  it("defaults openDialog to null when the dialog arg is omitted", () => {
    usePrefillStore.getState().setPrefill({ a: 1 });
    expect(usePrefillStore.getState().openDialog).toBeNull();
  });

  it("stores an explicit openDialog value alongside prefillData", () => {
    usePrefillStore.getState().setPrefill({ a: 1 }, "add-supplier");
    expect(usePrefillStore.getState().openDialog).toBe("add-supplier");
    expect(usePrefillStore.getState().prefillData).toEqual({ a: 1 });
  });

  it("consume() on empty storage returns the EMPTY snapshot shape", () => {
    const consumed = usePrefillStore.getState().consume();
    expect(consumed).toEqual({ prefillData: null, openDialog: null });
  });

  it("consume() clears storage even when only openDialog was set (no prefillData)", () => {
    usePrefillStore.getState().setPrefill(undefined as unknown as Record<string, unknown>, "just-a-dialog");
    expect(usePrefillStore.getState().openDialog).toBe("just-a-dialog");

    const consumed = usePrefillStore.getState().consume();
    // toStrictEqual (not toEqual): JSON.stringify() drops the `prefillData:
    // undefined` slot on write, so the parsed-back object has no `prefillData`
    // key at all — toEqual would ignore that distinction, but toStrictEqual
    // catches it.
    expect(consumed).toStrictEqual({ openDialog: "just-a-dialog" });
    expect(usePrefillStore.getState().openDialog).toBeNull();
  });
});

describe("sessionStorage persistence", () => {
  it("persists JSON under the 'mgr-prefill' key", () => {
    usePrefillStore.getState().setPrefill({ foo: "bar" }, "d1");
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      prefillData: { foo: "bar" },
      openDialog: "d1",
    });
  });

  it("removes the storage key once consumed", () => {
    usePrefillStore.getState().setPrefill({ foo: "bar" });
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    usePrefillStore.getState().consume();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("has no live cache: state getters re-read sessionStorage on every access", () => {
    // Mutate storage directly (bypassing setPrefill) and confirm the getter
    // picks it up immediately, since `read()` runs on every property access.
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ prefillData: { direct: true }, openDialog: "x" }),
    );
    expect(usePrefillStore.getState().prefillData).toEqual({ direct: true });
    expect(usePrefillStore.getState().openDialog).toBe("x");

    sessionStorage.removeItem(STORAGE_KEY);
    expect(usePrefillStore.getState().prefillData).toBeNull();
  });

  it("quirk: an empty-object prefillData ({}) is truthy and IS persisted (not treated as empty)", () => {
    // write() only removeItem()s when both prefillData and openDialog are
    // falsy; `{}` is a truthy object reference, so it is written as-is.
    usePrefillStore.getState().setPrefill({});
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(usePrefillStore.getState().prefillData).toEqual({});
  });
});

describe("JSON round-trip fidelity", () => {
  it("preserves nested arrays, numbers, booleans, and null values", () => {
    const data = {
      items: [1, 2, 3],
      nested: { flag: true, missing: null },
      label: "café",
    };
    usePrefillStore.getState().setPrefill(data, "review-dialog");
    expect(usePrefillStore.getState().consume()).toEqual({
      prefillData: data,
      openDialog: "review-dialog",
    });
  });

  it("drops keys whose value is undefined (JSON.stringify semantics)", () => {
    const data = { a: 1, b: undefined } as unknown as Record<string, unknown>;
    usePrefillStore.getState().setPrefill(data);
    // `b: undefined` is stripped by JSON.stringify, so it never round-trips.
    expect(usePrefillStore.getState().prefillData).toEqual({ a: 1 });
  });
});

describe("malformed / unavailable storage (swallowed-error characterization)", () => {
  it("read() treats malformed JSON in storage as EMPTY rather than throwing", () => {
    sessionStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => usePrefillStore.getState().prefillData).not.toThrow();
    expect(usePrefillStore.getState().prefillData).toBeNull();
    expect(usePrefillStore.getState().openDialog).toBeNull();
  });

  it("read() swallows a throwing sessionStorage.getItem and returns EMPTY", () => {
    const getItemSpy = vi.spyOn(storageProto, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(() => usePrefillStore.getState().prefillData).not.toThrow();
    expect(usePrefillStore.getState().prefillData).toBeNull();
    expect(usePrefillStore.getState().openDialog).toBeNull();
    // Guard against the spy silently failing to intercept (e.g. if jsdom ever
    // makes `getItem` an own property rather than a prototype method) — in
    // that case the assertions above would pass vacuously against a real,
    // empty sessionStorage instead of exercising the throw path.
    expect(getItemSpy).toHaveBeenCalled();
  });

  it("write() swallows a throwing sessionStorage.setItem without propagating", () => {
    const setItemSpy = vi.spyOn(storageProto, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => usePrefillStore.getState().setPrefill({ a: 1 })).not.toThrow();
    // The failed write leaves storage untouched.
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    // Guard against the spy silently failing to intercept (see above).
    expect(setItemSpy).toHaveBeenCalled();
  });

  it("quirk: consume() still returns the read snapshot even when the follow-up clear silently fails", () => {
    usePrefillStore.getState().setPrefill({ a: 1 }, "dlg");
    const removeItemSpy = vi.spyOn(storageProto, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const consumed = usePrefillStore.getState().consume();
    expect(consumed).toEqual({ prefillData: { a: 1 }, openDialog: "dlg" });

    // Because the internal removeItem() threw and was swallowed, the stale
    // entry is left behind in sessionStorage despite consume() having
    // returned it once already.
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    // Guard against the spy silently failing to intercept (see above).
    expect(removeItemSpy).toHaveBeenCalled();
  });
});

describe("selector API (zustand-shaped call sites)", () => {
  it("no-arg call returns the full state object", () => {
    const full = usePrefillStore();
    expect(full).toBe(usePrefillStore.getState());
  });

  it("selector form picks a single slice, e.g. (s) => s.setPrefill", () => {
    const setPrefill = usePrefillStore((s) => s.setPrefill);
    expect(setPrefill).toBe(usePrefillStore.getState().setPrefill);
  });

  it("selector form reflects live state for data slices", () => {
    usePrefillStore.getState().setPrefill({ x: 1 }, "d");
    expect(usePrefillStore((s) => s.prefillData)).toEqual({ x: 1 });
    expect(usePrefillStore((s) => s.openDialog)).toBe("d");
  });
});
