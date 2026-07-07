/**
 * Auth Shell
 *
 * Split-screen wrapper used by auth pages (login, forgot-password,
 * update-password; signup removed — invite-only). Left panel: MGR branding. Right panel: form content.
 * On mobile the left panel is hidden.
 */

import type { ReactNode } from "react";
import { MGRIcon } from "@/components/icons/mgr-logo";

type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="relative min-h-screen items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col p-10 text-primary lg:flex dark:border-r" aria-hidden="true">
        <div className="absolute inset-0 bg-primary/5" />
        <div className="relative z-20 flex items-center text-lg font-medium">
          <MGRIcon size={24} className="mr-2" />
          MGR
        </div>
        <div className="relative z-20 mt-auto">
          <p className="text-balance leading-normal">
            Brewery management, simplified.
          </p>
        </div>
      </div>
      <div className="flex min-h-screen items-center justify-center p-4 lg:p-8">
        <div className="mx-auto flex w-full max-w-[350px] flex-col justify-center gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}
