# AI Write Actions v2 — Future Direction

## Problem

The current navigation-based write pattern (AI tool → prefill store → router.push → form page) is fragile. Prefill data gets lost during Next.js App Router page transitions despite both in-memory Zustand and sessionStorage backing. The indirection through an ephemeral store creates timing and serialization issues that are hard to debug.

## Desired UX

1. User asks the AI to do something (e.g., "create a batch of Hazy IPA")
2. AI prepares the data via tool call
3. A **confirmation dialog** appears inline in the chat (or as a modal) showing exactly what will be submitted
4. User reviews, optionally edits, and confirms
5. The write executes directly via API — no navigation required

## Requirements

- AI write actions should go through a proper API (server actions or API routes), not the navigate-to-form workaround
- All writes must be user-confirmed before execution
- The confirmation UI should clearly show what's being created/modified
- Reuse existing Zod schemas for validation
- Maintain existing RLS and auth checks server-side

## Open Questions

- Should the confirmation dialog be rendered inline in the chat panel, or as a standalone modal?
- How to handle complex forms (e.g., recipes with ingredient sub-tables) that don't map cleanly to a flat confirmation view?
- Should the AI be able to execute simple transitions (e.g., batch status changes) with a lightweight confirm, while complex creates still use full forms?
- How to share validation logic between the entity form and the AI confirmation path?

## Status

Parked — revisit when a robust API layer is available.
