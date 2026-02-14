"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  type UserRole,
  type Permission,
  getPermissions,
} from "@/lib/permissions";

interface PermissionContextValue {
  roles: UserRole[];
  permissions: Permission[];
  can: (permission: Permission) => boolean;
  hasRole: (role: UserRole) => boolean;
}

const PermissionContext = createContext<PermissionContextValue | null>(null);

interface PermissionProviderProps {
  roles: UserRole[];
  children: ReactNode;
}

export function PermissionProvider({ roles, children }: PermissionProviderProps) {
  const value = useMemo(() => {
    const permissions = getPermissions(roles);
    const permissionSet = new Set<Permission>(permissions);
    return {
      roles,
      permissions,
      can: (permission: Permission) => permissionSet.has(permission),
      hasRole: (role: UserRole) => roles.includes(role),
    };
  }, [roles]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions(): PermissionContextValue {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error("usePermissions must be used within PermissionProvider");
  }
  return context;
}
