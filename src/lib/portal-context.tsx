"use client";
import { createContext, useContext } from "react";

interface PortalContextValue {
  customerId: string;
  customerName: string;
}

const PortalContext = createContext<PortalContextValue | null>(null);

export function PortalProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: PortalContextValue;
}) {
  return (
    <PortalContext.Provider value={value}>{children}</PortalContext.Provider>
  );
}

export function usePortalCustomer() {
  const ctx = useContext(PortalContext);
  if (!ctx)
    throw new Error("usePortalCustomer must be used within PortalProvider");
  return ctx;
}
