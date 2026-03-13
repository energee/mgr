# WCAG 2.1 AA+ Accessibility Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the MGR brewery management app to WCAG 2.1 AA compliance (with select AAA criteria) by fixing universal components that propagate to all entity pages, then domain-specific components.

**Architecture:** Universal-first approach. The app uses a config-driven entity system where ~5 universal components render all 15+ entity pages. Fixing `field-input.tsx`, `entity-data-table.tsx`, and `entity-detail-unified.tsx` covers the majority of issues. Domain components (chart, notifications, chat) need individual fixes. Global CSS handles contrast and reduced motion.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS v4, shadcn/ui (Radix primitives), Recharts v3, eslint-plugin-jsx-a11y

**Design doc:** `docs/plans/2026-02-12-wcag-accessibility-design.md`

---

### Task 1: Color Contrast & Reduced Motion (`globals.css`)

**Files:**
- Modify: `src/app/globals.css:94` (light muted-foreground), `:155` (dark muted-foreground)

**Step 1: Bump muted-foreground for contrast compliance**

In `src/app/globals.css`, change the light mode muted-foreground (line 94):

```css
/* Before */
--muted-foreground: oklch(0.50 0.015 60);

/* After — passes 4.5:1 against oklch(0.985) background */
--muted-foreground: oklch(0.40 0.015 60);
```

Change the dark mode muted-foreground (line 155):

```css
/* Before */
--muted-foreground: oklch(0.65 0.015 60);

/* After — passes 4.5:1 against oklch(0.16) background */
--muted-foreground: oklch(0.72 0.015 60);
```

**Step 2: Add prefers-reduced-motion styles**

Append to the end of `globals.css`, before the closing of the file:

```css
/* Reduced motion: disable all animations for users who prefer it */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Step 3: Verify status badge contrast**

Check `status-badge.tsx` color combos. The `info` variant uses `text-orange-700` on `bg-orange-50` (Tailwind defaults). Tailwind's orange-700 on orange-50 is approximately 4.6:1 — passes AA. The `success`, `warning`, and `error` variants use similar Tailwind color pairings that also pass. No changes needed to status-badge.tsx.

**Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "fix(a11y): bump muted-foreground contrast and add prefers-reduced-motion"
```

---

### Task 2: Skip Navigation & Landmark Fix (`layout.tsx`, `chat-layout.tsx`)

**Files:**
- Modify: `src/app/layout.tsx:33` (add skip link)
- Modify: `src/components/domain/chat-layout.tsx:15` (fix duplicate `<main>`)

**Important context:** There are currently TWO `<main>` elements — `SidebarInset` (from shadcn's `sidebar.tsx`) renders `<main>`, and `ChatLayout` also renders `<main>`. This is invalid HTML. The fix: change `ChatLayout`'s inner `<main>` to a `<div>` and add `id="main-content"` to it, since `SidebarInset` is the outer semantic `<main>`.

**Step 1: Add skip-to-content link in root layout**

In `src/app/layout.tsx`, add the skip link as the first child of `<body>`:

```tsx
<body className={`${dmSans.variable} ${dmMono.variable} font-sans antialiased`}>
  <a
    href="#main-content"
    className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-background focus:text-foreground focus:rounded-md focus:border focus:border-border focus:shadow-sm"
  >
    Skip to main content
  </a>
  <Providers>{children}</Providers>
</body>
```

**Step 2: Fix duplicate main landmark in ChatLayout**

In `src/components/domain/chat-layout.tsx`, change line 15:

```tsx
/* Before */
<main className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</main>

/* After — SidebarInset is already <main>, so this becomes a <div> with the skip target ID */
<div id="main-content" className="flex-1 p-4 md:p-6 overflow-y-auto">{children}</div>
```

**Step 3: Commit**

```bash
git add src/app/layout.tsx src/components/domain/chat-layout.tsx
git commit -m "fix(a11y): add skip navigation link and fix duplicate main landmark"
```

---

### Task 3: Form Accessibility (`field-input.tsx`)

**Files:**
- Modify: `src/components/universal/field-input.tsx`

**Context:** `FieldInput` renders the label, input, description, and error for every form field in the app. `renderFieldInput` is a separate function that renders just the input element — it receives `field`, `value`, `onChange`, `disabled`, and `dynamicOptions` but NOT `error`. We need to pass ARIA attributes through.

**Step 1: Update `renderFieldInput` signature to accept ARIA props**

Add a new parameter to `renderFieldInput`:

```typescript
interface FieldAriaProps {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}

export function renderFieldInput(
  field: FieldDef,
  value: unknown,
  onChange: (value: unknown) => void,
  disabled?: boolean,
  dynamicOptions?: { value: string; label: string }[],
  ariaProps?: FieldAriaProps
) {
```

**Step 2: Spread ARIA props onto every input element**

For each `case` in the `switch`, spread `{...ariaProps}` onto the primary input element. Examples:

```tsx
case "text":
  return (
    <Input
      id={field.name}
      type="text"
      value={(value as string) || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      disabled={disabled}
      {...ariaProps}
    />
  );
```

Apply the same pattern to: `textarea`, `number`, `select` (on `SelectTrigger`), `relation` (on `ComboboxInput`), `switch` (on `Switch`), `date` (on `DatePicker`), `datetime` (on `DateTimePicker`), `unit` (on `UnitInput` and the fallback `Input`), and the `default` case.

**Step 3: Update `FieldInput` to compute and pass ARIA props**

```tsx
export function FieldInput({
  field,
  value,
  error,
  onChange,
  disabled,
  dynamicOptions,
}: FieldInputProps) {
  // Build aria-describedby from present elements
  const describedByParts: string[] = [];
  if (error) describedByParts.push(`${field.name}-error`);
  if (field.description) describedByParts.push(`${field.name}-description`);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;

  const ariaProps: FieldAriaProps = {
    ...(describedBy && { "aria-describedby": describedBy }),
    ...(error && { "aria-invalid": true }),
    ...(field.required && { "aria-required": true }),
  };

  return (
    <div className={getColSpanClass(field.colSpan, field.fullWidth)}>
      <Label htmlFor={field.name} className={field.required ? "required" : ""}>
        {field.label}
        {field.required && (
          <>
            <span className="text-destructive ml-1" aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </>
        )}
      </Label>

      <div className="mt-1.5">
        {renderFieldInput(field, value, onChange, disabled, dynamicOptions, ariaProps)}
      </div>

      {field.description && (
        <p id={`${field.name}-description`} className="text-sm text-muted-foreground mt-1">
          {field.description}
        </p>
      )}

      {error && (
        <p id={`${field.name}-error`} role="alert" className="text-sm text-destructive mt-1">
          {error}
        </p>
      )}
    </div>
  );
}
```

**Step 4: Run lint to verify**

```bash
bun lint
```

Expected: No new errors (existing warnings unchanged).

**Step 5: Commit**

```bash
git add src/components/universal/field-input.tsx
git commit -m "fix(a11y): add aria-describedby, aria-invalid, and aria-required to form fields"
```

---

### Task 4: Entity Data Table Accessibility (`entity-data-table.tsx`)

**Files:**
- Modify: `src/components/universal/entity-data-table.tsx`

**Step 1: Add aria-labels and aria-pressed to view toggle buttons**

At lines 599-614, update the view toggle buttons:

```tsx
<Button
  variant={viewMode === "table" ? "default" : "outline"}
  size="icon"
  className="h-8 w-8"
  onClick={() => setViewMode("table")}
  aria-label="Table view"
  aria-pressed={viewMode === "table"}
>
  <LayoutList className="h-4 w-4" />
</Button>
<Button
  variant={viewMode === "board" ? "default" : "outline"}
  size="icon"
  className="h-8 w-8"
  onClick={() => setViewMode("board")}
  aria-label="Board view"
  aria-pressed={viewMode === "board"}
>
  <KanbanIcon className="h-4 w-4" />
</Button>
```

**Step 2: Make loading spinner accessible**

Find the loading spinner (search for `animate-spin rounded-full`) and wrap it:

```tsx
/* Before */
<div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />

/* After */
<div role="status">
  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  <span className="sr-only">Loading</span>
</div>
```

**Step 3: Hide decorative Kbd elements**

Find `<Kbd>` elements that appear alongside button text (like `<Kbd>N</Kbd>` on "New Entity" buttons). These are visual hints only. Wrap them:

```tsx
/* Before */
<Kbd>N</Kbd>

/* After */
<span aria-hidden="true"><Kbd>N</Kbd></span>
```

**Step 4: Run lint**

```bash
bun lint
```

**Step 5: Commit**

```bash
git add src/components/universal/entity-data-table.tsx
git commit -m "fix(a11y): add labels to view toggles, accessible loading state, and hide decorative Kbd"
```

---

### Task 5: Entity Detail Unified (`entity-detail-unified.tsx`)

**Files:**
- Modify: `src/components/universal/entity-detail-unified.tsx`

**Step 1: Fix aria-hidden boolean attribute**

Find the hidden submit button (search for `aria-hidden` near `submitRef`):

```tsx
/* Before */
<button
  ref={submitRef}
  type="button"
  className="hidden"
  onClick={handleSave}
  aria-hidden
/>

/* After */
<button
  ref={submitRef}
  type="button"
  className="hidden"
  onClick={handleSave}
  aria-hidden="true"
/>
```

**Step 2: Add form error summary on validation failure**

Find the `handleSave` function. After the Zod validation failure block (where `result.error.issues` are iterated), add logic to set a ref for the error summary:

First, add a ref near the other refs at the top of the component:

```tsx
const errorSummaryRef = useRef<HTMLDivElement>(null);
```

Add state for tracking form-level errors:

```tsx
const [formErrors, setFormErrors] = useState<{ field: string; message: string }[]>([]);
```

In the `handleSave` function, after setting field errors from Zod validation failure, also populate the summary and focus it:

```tsx
if (!result.success) {
  const errors: { field: string; message: string }[] = [];
  for (const err of result.error.issues) {
    const fieldPath = err.path.join(".");
    form.setError(fieldPath, { message: err.message });
    errors.push({ field: fieldPath, message: err.message });
  }
  setFormErrors(errors);
  // Focus the error summary after render
  requestAnimationFrame(() => errorSummaryRef.current?.focus());
  return;
}
// Clear errors on successful validation
setFormErrors([]);
```

Also add the same pattern for the `form.trigger()` failure case (lines ~500-501):

```tsx
const isValid = await form.trigger();
if (!isValid) {
  // Collect errors from react-hook-form
  const errors = Object.entries(form.formState.errors)
    .filter(([, err]) => err?.message)
    .map(([field, err]) => ({ field, message: err!.message as string }));
  setFormErrors(errors);
  requestAnimationFrame(() => errorSummaryRef.current?.focus());
  return;
}
```

Render the error summary just above the form sections (inside the editing form area):

```tsx
{formErrors.length > 0 && (
  <div
    ref={errorSummaryRef}
    role="alert"
    tabIndex={-1}
    className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive outline-none"
  >
    <p className="font-medium">
      Please fix {formErrors.length} {formErrors.length === 1 ? "error" : "errors"}:
    </p>
    <ul className="mt-1 list-disc pl-5">
      {formErrors.map((err) => (
        <li key={err.field}>
          <a href={`#${err.field}`} className="underline hover:no-underline">
            {err.message}
          </a>
        </li>
      ))}
    </ul>
  </div>
)}
```

Also clear errors when entering edit mode and when successfully saving.

**Step 3: Hide Kbd elements in detail unified**

Same pattern as Task 4 — find `<Kbd>` elements next to buttons and wrap with `aria-hidden="true"`.

**Step 4: Run lint**

```bash
bun lint
```

**Step 5: Commit**

```bash
git add src/components/universal/entity-detail-unified.tsx
git commit -m "fix(a11y): add form error summary, fix aria-hidden, hide decorative Kbd"
```

---

### Task 6: Domain Components (chat, notifications, header)

**Files:**
- Modify: `src/components/domain/chat-panel.tsx:133`
- Modify: `src/components/domain/notification-bell.tsx:92,123,253`
- Modify: `src/components/domain/app-header.tsx:60`

**Step 1: Chat panel maximize/minimize label**

In `chat-panel.tsx`, add `aria-label` to the toggle button at line ~133:

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-6 w-6"
  onClick={() => setIsMaximized((prev) => !prev)}
  aria-label={isMaximized ? "Minimize chat" : "Maximize chat"}
>
```

**Step 2: Notification bell accessibility**

In `notification-bell.tsx`:

a) Add screen reader text to priority dots (near line 92):

```tsx
/* Before */
<div
  className={cn(
    "w-2 h-2 rounded-full mt-2 flex-shrink-0",
    getPriorityColor(notification.priority)
  )}
/>

/* After */
<div
  className={cn(
    "w-2 h-2 rounded-full mt-2 flex-shrink-0",
    getPriorityColor(notification.priority)
  )}
  aria-hidden="true"
/>
<span className="sr-only">{notification.priority} priority</span>
```

b) Change `title` to `aria-label` on action buttons (lines ~123, ~138):

```tsx
/* Before */
title="Mark as read"

/* After */
aria-label="Mark as read"
```

Same for the "Dismiss" button.

c) Add `aria-hidden` to decorative AnimatedBell in empty state (line ~253):

```tsx
<AnimatedBell className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
```

**Step 3: App header logo alt text**

In `app-header.tsx`, the component receives `breweryName` as a prop. Update the img (line ~60):

```tsx
/* Before */
alt=""

/* After */
alt={breweryName || "Brewery logo"}
```

**Step 4: Run lint**

```bash
bun lint
```

**Step 5: Commit**

```bash
git add src/components/domain/chat-panel.tsx src/components/domain/notification-bell.tsx src/components/domain/app-header.tsx
git commit -m "fix(a11y): add labels to chat toggle, notification buttons, and brewery logo"
```

---

### Task 7: Sidebar Navigation Landmark (`app-sidebar.tsx`)

**Files:**
- Modify: `src/components/domain/app-sidebar.tsx`

**Context:** The shadcn `<Sidebar>` component renders a `<div>`, not a `<nav>`. The `<SidebarContent>` section contains the navigation links.

**Step 1: Wrap SidebarContent in nav**

In `app-sidebar.tsx`, wrap the `<SidebarContent>` block in a `<nav>`:

```tsx
/* Before */
<SidebarContent>
  {navigation.map((section) => (
    <Collapsible ...>

/* After */
<SidebarContent>
  <nav aria-label="Main navigation">
    {navigation.map((section) => (
      <Collapsible ...>
```

And close the `</nav>` before `</SidebarContent>`.

**Step 2: Run lint**

```bash
bun lint
```

**Step 3: Commit**

```bash
git add src/components/domain/app-sidebar.tsx
git commit -m "fix(a11y): wrap sidebar navigation in nav landmark"
```

---

### Task 8: Chart Accessibility (`batch-readings-chart.tsx`)

**Files:**
- Modify: `src/components/domain/batch-readings-chart.tsx`

**Context:** The chart uses `chartData` which is an array of `{ timestamp, date, time, fullDate, value, unit }`. The `activeMetric` state determines which metric is displayed (gravity, temperature, pH). The chart config has labels for each metric.

**Step 1: Wrap chart in figure with aria-label**

```tsx
/* Before */
<ChartContainer config={chartConfig} className="h-[250px] w-full">

/* After */
<figure aria-label={`${chartConfig[activeMetric]?.label ?? activeMetric} readings over time`}>
  <ChartContainer config={chartConfig} className="h-[250px] w-full">
```

Close `</figure>` after `</ChartContainer>`.

**Step 2: Add visually-hidden data table after ChartContainer**

Inside the `<figure>`, after `</ChartContainer>`:

```tsx
<table className="sr-only">
  <caption>{chartConfig[activeMetric]?.label ?? activeMetric} readings</caption>
  <thead>
    <tr>
      <th scope="col">Date</th>
      <th scope="col">Value</th>
    </tr>
  </thead>
  <tbody>
    {chartData.map((point) => (
      <tr key={point.timestamp}>
        <td>{point.fullDate}</td>
        <td>{point.value}{point.unit}</td>
      </tr>
    ))}
  </tbody>
</table>
```

**Step 3: Run lint**

```bash
bun lint
```

**Step 4: Commit**

```bash
git add src/components/domain/batch-readings-chart.tsx
git commit -m "fix(a11y): add figure label and hidden data table for chart screen reader access"
```

---

### Task 9: Stricter ESLint a11y Rules

**Files:**
- Modify: `eslint.config.mjs`

**Context:** Currently uses `eslint-config-next/core-web-vitals` which includes jsx-a11y in recommended mode. We want to switch to strict mode.

**Step 1: Install jsx-a11y plugin explicitly (if needed) and configure strict rules**

First check if `eslint-plugin-jsx-a11y` is already installed (it comes with `eslint-config-next`):

```bash
ls node_modules/eslint-plugin-jsx-a11y/package.json
```

Then update `eslint.config.mjs` to add strict jsx-a11y overrides after the Next.js presets:

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      // Upgrade from recommended to strict
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/html-has-lang": "error",
      "jsx-a11y/img-redundant-alt": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-access-key": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/no-distracting-elements": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-noninteractive-tabindex": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
```

**Step 2: Run lint and fix any new errors**

```bash
bun lint
```

Fix any errors surfaced by the stricter rules. These should be minimal since Tasks 1-8 already fixed the main issues.

**Step 3: Commit**

```bash
git add eslint.config.mjs
# Include any files fixed by stricter lint rules
git commit -m "fix(a11y): enable strict jsx-a11y ESLint rules"
```

---

### Task 10: Final Verification

**Step 1: Run full lint**

```bash
bun lint
```

Expected: 0 errors. Warnings may remain for pre-existing issues outside our scope.

**Step 2: Run build**

```bash
bun build
```

Expected: Build succeeds with no type errors.

**Step 3: Commit any remaining fixes**

If lint or build surfaced anything, fix and commit.

---

## Task Dependency Graph

```
Task 1 (CSS contrast + motion)
Task 2 (skip link + landmark fix)  ── can run in parallel with 1
Task 3 (field-input.tsx)           ── can run in parallel with 1, 2
Task 4 (entity-data-table.tsx)     ── can run in parallel with 1, 2, 3
Task 5 (entity-detail-unified)     ── depends on Task 3 patterns (FieldAriaProps)
Task 6 (domain components)         ── can run in parallel with 1-5
Task 7 (sidebar nav)               ── can run in parallel with 1-6
Task 8 (chart accessibility)       ── can run in parallel with 1-7
Task 9 (ESLint strict)             ── depends on Tasks 1-8 (fixes must be in first)
Task 10 (verification)             ── depends on Task 9
```

Tasks 1-4 and 6-8 are fully independent. Task 5 benefits from Task 3's pattern. Task 9 runs after all fixes. Task 10 is final verification.
