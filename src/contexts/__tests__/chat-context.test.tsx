// @vitest-environment jsdom
/**
 * Characterization tests for ChatProvider / useChatContext (src/contexts/chat-context.tsx).
 *
 * Pins current behavior of:
 *  - useChatContext() throwing outside a ChatProvider
 *  - isOpen state transitions via toggle()/close()
 *  - the Cmd+. / Ctrl+. global keyboard shortcut (and its listener cleanup)
 *  - parsePageContext(pathname) (internal, exercised indirectly through the
 *    `pageContext` value on context, driven by a mocked next/navigation
 *    usePathname())
 *
 * `useChat` (@ai-sdk/react) is mocked so no network/LLM calls happen and the
 * `chat` object on context is a plain, inspectable stub. `next/navigation`'s
 * usePathname is mocked so pathname is controllable per test. `ai`'s
 * DefaultChatTransport is replaced with a constructor-capturing test class
 * (the rest of the `ai` module is kept real) so the transport-wiring test can
 * assert the exact constructor options the provider passes, without reaching
 * into the real transport's TypeScript-protected internals.
 *
 * Follows the repo's render-test idiom via the shared createRoot + act
 * harness (see src/test/react-harness.ts; no @testing-library/react).
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { setupRenderHarness } from "@/test/react-harness";

const { pathnameState, chatState, transports } = vi.hoisted(() => ({
  pathnameState: { current: "/" },
  chatState: { current: null as unknown as UseChatHelpers<UIMessage> },
  /** One record per `new DefaultChatTransport(...)` call, in call order. */
  transports: [] as Array<{ args: unknown; instance: unknown }>,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.current,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => chatState.current),
}));

// Keep the real `ai` module but swap DefaultChatTransport for a test class
// that records its constructor options and instances, so tests can assert the
// provider's wiring without touching third-party internals. Tradeoff: the
// real class is never constructed at runtime here; drift in its constructor
// contract is caught by tsc (the provider is compiled against the real
// declarations), not by this test.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  class CapturingChatTransport {
    constructor(options: unknown) {
      transports.push({ args: options, instance: this });
    }
  }
  return { ...actual, DefaultChatTransport: CapturingChatTransport };
});

import { ChatProvider, useChatContext } from "../chat-context";

type ChatContextValue = ReturnType<typeof useChatContext>;

function makeChat(): UseChatHelpers<UIMessage> {
  return {
    id: "test-chat-id",
    setMessages: vi.fn(),
    error: undefined,
    sendMessage: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
    resumeStream: vi.fn(),
    addToolResult: vi.fn(),
    addToolOutput: vi.fn(),
    addToolApprovalResponse: vi.fn(),
    status: "ready",
    messages: [],
    clearError: vi.fn(),
  };
}

const { render, unmount } = setupRenderHarness();

// File-specific teardown (the shared harness handles unmount/container
// removal). restoreAllMocks undoes every vi.spyOn in one place so an
// assertion failure mid-test can't leak a silenced console.error (or a
// document listener spy) into later tests; the module mocks above are
// factory-based (not vi.spyOn) so their implementations survive it.
afterEach(() => {
  // Unmount BEFORE restoring spies: same-level afterEach hooks run LIFO, so
  // the shared harness's cleanup (registered first) would otherwise run
  // after restoreAllMocks, i.e. spies would be restored on a still-mounted
  // tree.
  unmount();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  pathnameState.current = "/";
  transports.length = 0;
});

function Probe({ onRender }: { onRender: (v: ChatContextValue) => void }) {
  const ctx = useChatContext();
  onRender(ctx);
  return null;
}

function renderProvider(onRender: (v: ChatContextValue) => void): HTMLElement {
  return render(
    <ChatProvider>
      <Probe onRender={onRender} />
    </ChatProvider>,
  );
}

describe("useChatContext", () => {
  it("throws when called outside a ChatProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Bad() {
      useChatContext();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(
      "useChatContext must be used within ChatProvider",
    );
  });
});

describe("ChatProvider", () => {
  beforeEach(() => {
    chatState.current = makeChat();
  });

  it("starts closed and exposes the useChat() return value plus derived pageContext", () => {
    pathnameState.current = "/";
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));
    const latest = values[values.length - 1];
    expect(latest.isOpen).toBe(false);
    expect(latest.chat).toBe(chatState.current);
    expect(latest.pageContext).toBeUndefined();
  });

  it("toggle() flips isOpen, and flips back on a second call", () => {
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));
    act(() => values[values.length - 1].toggle());
    expect(values[values.length - 1].isOpen).toBe(true);
    act(() => values[values.length - 1].toggle());
    expect(values[values.length - 1].isOpen).toBe(false);
  });

  it("close() forces isOpen to false, and is a no-op when already closed", () => {
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));
    // close() while already closed
    act(() => values[values.length - 1].close());
    expect(values[values.length - 1].isOpen).toBe(false);

    act(() => values[values.length - 1].toggle());
    expect(values[values.length - 1].isOpen).toBe(true);

    act(() => values[values.length - 1].close());
    expect(values[values.length - 1].isOpen).toBe(false);
  });

  it("Cmd+. toggles isOpen open, Ctrl+. toggles it closed again, and preventDefault is called", () => {
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));

    const evtMeta = new KeyboardEvent("keydown", {
      key: ".",
      metaKey: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(evtMeta, "preventDefault");
    act(() => {
      document.dispatchEvent(evtMeta);
    });
    expect(values[values.length - 1].isOpen).toBe(true);
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1);

    const evtCtrl = new KeyboardEvent("keydown", {
      key: ".",
      ctrlKey: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(evtCtrl);
    });
    expect(values[values.length - 1].isOpen).toBe(false);
  });

  it("ignores '.' without a modifier, and a modifier with a different key", () => {
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "." }));
    });
    expect(values[values.length - 1].isOpen).toBe(false);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true }),
      );
    });
    expect(values[values.length - 1].isOpen).toBe(false);
  });

  it("removes exactly the keydown listener it added when unmounted", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    renderProvider(() => {});

    const keydownAdd = addSpy.mock.calls.find(([type]) => type === "keydown");
    expect(keydownAdd).toBeDefined();
    const handler = keydownAdd![1];

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", handler);
  });

  describe("pageContext parsing (via mocked usePathname)", () => {
    function renderAndGetPageContext(
      pathname: string,
    ): ChatContextValue["pageContext"] {
      pathnameState.current = pathname;
      let latest: ChatContextValue | undefined;
      renderProvider((v) => {
        latest = v;
      });
      return latest?.pageContext;
    }

    // toStrictEqual (not toEqual) so the explicitly-undefined keys that
    // parsePageContext always returns (entityType/entityId) are pinned: a
    // regression that drops those keys fails these tests.
    it.each<[string, ChatContextValue["pageContext"]]>([
      // root / empty / unknown first segment -> no page context at all
      ["/", undefined],
      ["", undefined],
      ["/unknown-section", undefined],
      // bare known section, no entity segment
      [
        "/production",
        { section: "production", entityType: undefined, entityId: undefined },
      ],
      // known plural entity segment -> singular label
      [
        "/production/batches",
        { section: "production", entityType: "batch", entityId: undefined },
      ],
      // multi-word entity label
      [
        "/settings/beer-styles",
        { section: "settings", entityType: "beer style", entityId: undefined },
      ],
      // unrecognized entity segment under a known section
      [
        "/inventory/not-a-real-entity",
        { section: "inventory", entityType: undefined, entityId: undefined },
      ],
      // 3rd segment is an entityId only when exactly 36 hex/dash characters
      [
        "/production/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        {
          section: "production",
          entityType: "batch",
          entityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        },
      ],
      [
        "/production/batches/not-a-uuid",
        { section: "production", entityType: "batch", entityId: undefined },
      ],
    ])("derives pageContext from %j", (pathname, expected) => {
      expect(renderAndGetPageContext(pathname)).toStrictEqual(expected);
    });

    it("quirk: the id check is `/^[0-9a-f-]{36}$/i`, not a real UUID validator -- 36 dashes alone pass it", () => {
      const thirtySixDashes = "-".repeat(36);
      expect(
        renderAndGetPageContext(`/production/batches/${thirtySixDashes}`)
          ?.entityId,
      ).toBe(thirtySixDashes);
    });

    it("quirk: pageContext is a brand-new object every render, even for an unchanged pathname (not memoized)", () => {
      pathnameState.current = "/production/batches";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      const first = values[values.length - 1].pageContext;

      act(() => values[values.length - 1].toggle());
      const second = values[values.length - 1].pageContext;

      expect(second).toEqual(first);
      expect(second).not.toBe(first);
    });
  });

  it("wires useChat() with a DefaultChatTransport pointed at /api/chat carrying the current pageContext as body", () => {
    pathnameState.current = "/production/batches";
    renderProvider(() => {});

    const mockedUseChat = vi.mocked(useChat);
    expect(mockedUseChat).toHaveBeenCalled();
    const lastCallArgs = mockedUseChat.mock.calls.at(-1)?.[0] as
      | { transport?: unknown }
      | undefined;
    const transport = lastCallArgs?.transport;

    // The provider constructed the transport with exactly these options...
    expect(transports.at(-1)?.args).toStrictEqual({
      api: "/api/chat",
      body: {
        pageContext: {
          section: "production",
          entityType: "batch",
          entityId: undefined,
        },
      },
    });
    // ...and passed that same instance to useChat.
    expect(transport).toBeInstanceOf(DefaultChatTransport);
    expect(transport).toBe(transports.at(-1)?.instance);
  });
});
