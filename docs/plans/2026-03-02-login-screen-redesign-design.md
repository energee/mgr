# Login Screen Redesign — Split-Screen Layout

## Summary

Redesign the auth pages (login + signup) from a centered Card layout to a split-screen layout inspired by the [shadcn/ui authentication example](https://ui.shadcn.com/examples/authentication).

## Current State

- Auth layout: centered `max-w-md` Card on `bg-muted/30` background
- Login: MGR icon + title, email/password fields, magic link option, signup link
- Signup: title, email/password/confirm fields, login link
- Functional but visually flat — no brand presence beyond a small icon

## Design

### Layout (desktop — `lg` breakpoint and up)

Two-column grid, full viewport height:

```
┌─────────────────────┬──────────────────────┐
│                     │                      │
│  MGR icon + "MGR"   │                      │
│  (top-left)         │    "Sign in"         │
│                     │    subtitle          │
│                     │                      │
│  bg-primary/5       │    [email field]     │
│                     │    [password field]  │
│                     │    [sign in btn]     │
│                     │    ── Or ──          │
│                     │    [email code btn]  │
│                     │    signup link       │
│  "Manage your       │                      │
│   brewery..."       │                      │
│  (bottom-left)      │                      │
└─────────────────────┴──────────────────────┘
```

- Left panel: `bg-primary/5` with `dark:border-r`, MGR logo top-left, tagline bottom-left
- Right panel: vertically centered form, `max-w-[350px]`, no Card wrapper

### Layout (mobile — below `lg`)

Single column, just the form centered. Left panel hidden via `hidden lg:flex`.

### Left Panel Content

- Top: MGR unitank icon (24px) + "MGR" in `text-lg font-medium`
- Bottom: Tagline — "Brewery management, simplified." in a blockquote style

### Right Panel (Login)

- Heading: "Sign in" (`text-2xl font-semibold tracking-tight`)
- Subtitle: "Enter your credentials to access your brewery" (`text-sm text-muted-foreground`)
- Form: same fields and behavior as current (email, password, sign in, separator, email code, signup link)
- No Card wrapper — the split layout provides visual structure

### Right Panel (Signup)

- Heading: "Create an account"
- Subtitle: "Enter your details to get started"
- Form: same fields as current (email, password, confirm password, login link)

## Files Changed

| File | Change |
|------|--------|
| `src/app/(auth)/layout.tsx` | Replace centered Card layout with split-screen grid |
| `src/app/(auth)/login/page.tsx` | Remove Card wrapper, use heading + subtitle + form |
| `src/app/(auth)/signup/page.tsx` | Remove Card wrapper, match login page structure |

## Files NOT Changed

- `src/app/(auth)/login/login-form.tsx` — form logic stays identical
- `src/app/(auth)/signup/signup-form.tsx` — form logic stays identical
- `src/app/portal/(auth)/` — portal login is separate, not in scope

## Scope

- Visual/layout change only — no new functionality
- 3 files modified, 0 new files
- No database changes, no new dependencies
