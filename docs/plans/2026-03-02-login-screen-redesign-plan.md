# Login Screen Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign auth pages from centered Card to a split-screen layout matching the shadcn/ui authentication example.

**Architecture:** Replace the auth layout's centered wrapper with a two-column grid. Left panel shows MGR branding (logo + tagline), right panel shows the form. On mobile (`< lg`), left panel is hidden. Login and signup pages drop their Card wrappers and use headings + form directly.

**Tech Stack:** Next.js, Tailwind CSS, existing shadcn/ui components

---

### Task 1: Update auth layout to split-screen grid

**Files:**
- Modify: `src/app/(auth)/layout.tsx`

**Step 1: Replace layout JSX**

```tsx
/**
 * Auth Layout
 *
 * Split-screen layout for login/signup pages.
 * Left panel: MGR branding. Right panel: auth form.
 * On mobile, left panel is hidden.
 * Redirects logged-in users to the app.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MGRIcon } from "@/components/icons/mgr-logo";

export const metadata: Metadata = {
  title: "Sign In",
};

interface AuthLayoutProps {
  children: ReactNode;
}

export default async function AuthLayout({ children }: AuthLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/");
  }

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
```

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS — no type changes, just JSX restructure

**Step 3: Commit**

```bash
git add src/app/(auth)/layout.tsx
git commit -m "feat: split-screen auth layout with MGR branding panel"
```

---

### Task 2: Update login page — remove Card, use headings

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

**Step 1: Replace page JSX**

```tsx
/**
 * Login Page
 *
 * Email/password authentication with passwordless (magic link + OTP code) option.
 * Renders heading + subtitle + form inside the split-screen auth layout.
 */

import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Enter your credentials to access your brewery
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse" />}>
        <LoginForm />
      </Suspense>
    </>
  );
}
```

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS — removed Card imports, simpler JSX

**Step 3: Commit**

```bash
git add src/app/(auth)/login/page.tsx
git commit -m "feat: login page uses split-screen layout headings instead of Card"
```

---

### Task 3: Update signup page — remove Card, use headings, add MGR icon

**Files:**
- Modify: `src/app/(auth)/signup/page.tsx`

**Step 1: Replace page JSX**

```tsx
/**
 * Signup Page
 *
 * New user registration.
 * Renders heading + subtitle + form inside the split-screen auth layout.
 */

import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <>
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter your details to get started
        </p>
      </div>
      <SignupForm />
    </>
  );
}
```

**Step 2: Run typecheck**

Run: `bun typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `bun lint`
Expected: PASS — no unused imports, clean output

**Step 4: Commit**

```bash
git add src/app/(auth)/signup/page.tsx
git commit -m "feat: signup page uses split-screen layout headings instead of Card"
```

---

### Task 4: Visual verification

**Step 1: Start dev server and verify**

Run: `bun dev`

Check:
- `/login` — split layout on desktop, centered form on mobile
- `/signup` — same layout, matching headings
- Left panel shows MGR icon + tagline
- Form fields and buttons render correctly
- Magic link flow still works
- OTP verification flow still works

**Step 2: Final commit (if any tweaks needed)**

```bash
git add src/app/(auth)/layout.tsx src/app/(auth)/login/login-form.tsx
git commit -m "fix: auth layout visual adjustments"
```
