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
import { type UIMessage, DefaultChatTransport } from "ai";
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
  // Production
  batches: "batch",
  recipes: "recipe",
  "brew-logs": "brew log",
  vessels: "vessel",
  "vessel-transfers": "vessel transfer",
  "yeast-pitches": "yeast pitch",
  packaging: "packaging session",
  // Inventory
  "finished-goods": "finished good",
  items: "inventory item",
  lots: "inventory lot",
  allocations: "allocation",
  deliveries: "delivery",
  transfers: "location transfer",
  kegs: "keg inventory",
  bins: "bin",
  // Sales
  orders: "order",
  customers: "customer",
  "pick-lists": "pick list",
  // Purchasing
  pos: "purchase order",
  suppliers: "supplier",
  // Settings
  users: "user profile",
  locations: "location",
  brands: "brand",
  "beer-styles": "beer style",
  "keg-types": "keg type",
  "sales-channels": "sales channel",
  pricing: "pricing tier",
  yeasts: "yeast strain",
  "water-profiles": "water profile",
  formats: "package type",
};

const SECTIONS = new Set([
  "production",
  "packaging",
  "inventory",
  "purchasing",
  "sales",
  "reports",
  "settings",
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
  chat: UseChatHelpers<UIMessage>;
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
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { pageContext },
    }),
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
