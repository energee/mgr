"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useChat, type UseChatHelpers } from "@ai-sdk/react";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// Page context parsing
// ---------------------------------------------------------------------------

interface PageContext {
  section?: string;
  entityType?: string;
  entityId?: string;
}

/** Map URL path segments to entity types (plural path → singular entity) */
const ENTITY_MAP: Record<string, string> = {
  batches: "batch",
  recipes: "recipe",
  "brew-logs": "brew log",
  vessels: "vessel",
  "yeast-pitches": "yeast pitch",
  "packaging-sessions": "packaging session",
  "finished-goods": "finished good",
  hops: "hop",
  malts: "malt",
  yeasts: "yeast",
  "water-profiles": "water profile",
  "inventory-items": "inventory item",
  "purchase-orders": "purchase order",
  orders: "order",
  customers: "customer",
  "keg-inventory": "keg inventory",
  suppliers: "supplier",
  locations: "location",
};

const SECTIONS = new Set([
  "production",
  "packaging",
  "inventory",
  "purchasing",
  "sales",
  "reports",
]);

function parsePageContext(pathname: string): PageContext | undefined {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return undefined;

  const section = SECTIONS.has(segments[0]) ? segments[0] : undefined;
  if (!section) return undefined;

  const entitySegment = segments[1];
  const entityType = entitySegment ? ENTITY_MAP[entitySegment] : undefined;

  // UUID pattern for entity IDs
  const idSegment = segments[2];
  const isUuid = idSegment && /^[0-9a-f-]{36}$/i.test(idSegment);
  const entityId = isUuid ? idSegment : undefined;

  return { section, entityType, entityId };
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ChatContextValue {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  chat: UseChatHelpers;
  pageContext: PageContext | undefined;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface ChatProviderProps {
  children: ReactNode;
}

export function ChatProvider({ children }: ChatProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const pageContext = parsePageContext(pathname);

  const chat = useChat({
    body: { pageContext },
  });

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  // Cmd+. / Ctrl+. keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ChatContext.Provider value={{ isOpen, toggle, close, chat, pageContext }}>
      {children}
    </ChatContext.Provider>
  );
}
