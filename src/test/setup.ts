// Keep this file a module (required for top-level await) now that the only
// static import is gone.
export {};

// jest-dom's matchers only make sense (and are only referenced) in DOM tests.
// Loading it unconditionally taxed every node-environment test file with the
// full jest-dom + css-tools import graph, so gate it on a DOM being present.
// Setup files may use top-level await; this runs before any test imports.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
}

// Web Storage is missing under this jsdom setup: neither the bare `localStorage` global nor
// `window.localStorage` is defined (Node's own experimental global is undefined without
// --localstorage-file, and jsdom is not supplying one either). Any test — or any code under
// test — that calls `localStorage.getItem(...)` therefore throws on `undefined`. Supply a
// minimal in-memory Storage so the jsdom environment behaves like a browser.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

for (const key of ["localStorage", "sessionStorage"] as const) {
  if (typeof globalThis[key] === "undefined") {
    const store = memoryStorage();
    Object.defineProperty(globalThis, key, { value: store, configurable: true });
    if (typeof window !== "undefined") {
      Object.defineProperty(window, key, { value: store, configurable: true });
    }
  }
}
