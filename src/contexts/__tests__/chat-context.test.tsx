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
 * DefaultChatTransport is NOT mocked (its constructor has no side effects --
 * it only stores config); this lets us assert the provider wires up the real
 * transport with the expected api/body.
 *
 * Follows the repo's render-test idiom (createRoot + act; no
 * @testing-library/react) from
 * src/components/domain/recipe/__tests__/mash-schedule-editor.test.tsx.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";

const { pathnameState, chatState } = vi.hoisted(() => ({
  pathnameState: { current: "/" },
  chatState: { current: null as unknown as UseChatHelpers<UIMessage> },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.current,
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(() => chatState.current),
}));

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

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(el: ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

function unmount() {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => {
  unmount();
  vi.clearAllMocks();
  pathnameState.current = "/";
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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bad() {
      useChatContext();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(
      "useChatContext must be used within ChatProvider",
    );
    consoleError.mockRestore();
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

  it("removes its keydown listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const values: ChatContextValue[] = [];
    renderProvider((v) => values.push(v));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();
  });

  describe("pageContext parsing (via mocked usePathname)", () => {
    it("returns undefined for the root path", () => {
      pathnameState.current = "/";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toBeUndefined();
    });

    it("returns undefined for an empty pathname", () => {
      pathnameState.current = "";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toBeUndefined();
    });

    it("returns undefined when the first segment isn't a known section", () => {
      pathnameState.current = "/unknown-section";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toBeUndefined();
    });

    it("recognizes a bare section with no entity segment", () => {
      pathnameState.current = "/production";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toEqual({
        section: "production",
        entityType: undefined,
        entityId: undefined,
      });
    });

    it("maps a known plural entity segment to its singular label", () => {
      pathnameState.current = "/production/batches";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toEqual({
        section: "production",
        entityType: "batch",
        entityId: undefined,
      });
    });

    it("maps multi-word entity labels (e.g. beer-styles -> 'beer style')", () => {
      pathnameState.current = "/settings/beer-styles";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext?.entityType).toBe(
        "beer style",
      );
    });

    it("leaves entityType undefined for an unrecognized entity segment under a known section", () => {
      pathnameState.current = "/inventory/not-a-real-entity";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toEqual({
        section: "inventory",
        entityType: undefined,
        entityId: undefined,
      });
    });

    it("extracts a 3rd segment as entityId only when it is exactly 36 hex/dash characters", () => {
      pathnameState.current =
        "/production/batches/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext).toEqual({
        section: "production",
        entityType: "batch",
        entityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      });
    });

    it("does not treat a non-UUID-shaped 3rd segment as an entityId", () => {
      pathnameState.current = "/production/batches/not-a-uuid";
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext?.entityId).toBeUndefined();
    });

    it("quirk: the id check is `/^[0-9a-f-]{36}$/i`, not a real UUID validator -- 36 dashes alone pass it", () => {
      const thirtySixDashes = "-".repeat(36);
      pathnameState.current = `/production/batches/${thirtySixDashes}`;
      const values: ChatContextValue[] = [];
      renderProvider((v) => values.push(v));
      expect(values[values.length - 1].pageContext?.entityId).toBe(
        thirtySixDashes,
      );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lastCallArgs = mockedUseChat.mock.calls.at(-1)?.[0] as any;
    const transport = lastCallArgs?.transport;

    expect(transport).toBeInstanceOf(DefaultChatTransport);
    expect((transport as Record<string, unknown>).api).toBe("/api/chat");
    expect((transport as Record<string, unknown>).body).toEqual({
      pageContext: {
        section: "production",
        entityType: "batch",
        entityId: undefined,
      },
    });
  });
});
