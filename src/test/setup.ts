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
