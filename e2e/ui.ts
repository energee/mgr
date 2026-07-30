/**
 * Playwright helpers for two widgets in this app that a plain
 * locator-then-click cannot drive reliably: the Dice UI combobox, and any
 * control sitting under sonner's toast region.
 *
 * ## The combobox (`@diceui/combobox`, wrapped by `src/components/ui/combobox.tsx`)
 *
 * Why `pickComboboxOption` exists rather than a plain fill-then-click:
 *
 * Typing into `ComboboxInput` is what opens and filters the listbox — clicking
 * the input alone leaves the options unrendered. But the option lists in this
 * app are fed by React Query (`usePackagableBatches`, `usePackagingFormats`,
 * `useBrands`, …), and when the query has not resolved yet the content mounts
 * empty and does NOT re-open once the rows arrive. A failing trace's DOM
 * snapshot showed the steady state precisely: the input holding its typed
 * value with `aria-expanded="true"` and `aria-controls` pointing at an element
 * that is not in the document — no listbox, and not even the
 * "Loading…"/"No … found" empty state. The test then waits out its timeout
 * against options that will never render.
 *
 * Retyping after the data lands is what recovers it, so the whole interaction
 * is polled rather than just the assertion. Once the query is cached this
 * converges on the first attempt, so the common path costs nothing.
 *
 * The unpolled version failed 2 of 6 consecutive local runs of the
 * packaging flow; the polled version then passed 10 of 10 (issue #437).
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Types `text` into the combobox identified by its input `placeholder`, waits
 * for a matching option to render, and selects it.
 *
 * `text` is matched as a case-insensitive substring of the option's accessible
 * name (Playwright's default for a string `name`), which is what the callers
 * need: option labels here compose the identifier with extra detail — a batch
 * option reads "<code> <brand> <status badge> <volume>". Pass a string that
 * identifies one option; if it matches several, Playwright's strict mode
 * fails the locator rather than picking one silently.
 */
export async function pickComboboxOption(
  page: Page,
  placeholder: string,
  text: string,
): Promise<void> {
  const input = page.getByPlaceholder(placeholder);
  const option = page.getByRole("option", { name: text });

  await expect(async () => {
    // Clear first: refilling identical text is a no-op for the underlying
    // input event, so a retry that did not change the value would not
    // re-trigger the filter that mounts the content.
    await input.fill("");
    await input.fill(text);
    await expect(option).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  // Selection dispatches a click directly on the matched option, rather than
  // driving the mouse to it. `ComboboxContent` renders through a portal, and
  // when the combobox sits inside a Radix dialog (the Start Packaging dialog,
  // for one) the dialog's content paints above that portal and swallows the
  // pointer: Playwright reports "<div role='dialog'> … subtree intercepts
  // pointer events" and retries until it times out, even though the option is
  // visible and enabled the whole time.
  //
  // The two obvious alternatives were measured against this exact dialog and
  // both are worse:
  //   - `click({ force: true })` still routes by coordinates, so the event
  //     lands on the dialog. Observed result: the listbox closes and the input
  //     is left EMPTY — a silent non-selection that later fails somewhere
  //     unrelated.
  //   - ArrowDown + Enter commits the wrong row. Observed result: with the
  //     list filtered to a single match it still selected the first item of
  //     the unfiltered list ("Per Keg"), which a `selling_format_id`
  //     assertion caught only because it was checked against the DB.
  //
  // Dispatching on the element skips hit-testing entirely and cannot pick a
  // different row, which is the property that matters here.
  await option.dispatchEvent("click");

  // A committed selection closes the listbox. Asserting that (rather than
  // returning blind) keeps a silently-missed selection from surfacing later as
  // a confusing failure somewhere downstream.
  await expect(option).toBeHidden({ timeout: 10_000 });
}

/**
 * Clicks a control that sonner's toast region may be sitting on top of.
 *
 * Toasts render into a `position: fixed` region anchored top-right, which is
 * where `EntityDetailUnified` puts its action buttons. So a chain of
 * transitions covers its own next button: each one fires a "Status updated to
 * …" toast, the toasts stack, and Playwright's click retries against
 * "<li data-sonner-toast> … subtree intercepts pointer events" until the test
 * times out. Observed on the order chain — confirm -> schedule -> pick -> pack
 * -> fulfil — where it took out one run in three.
 *
 * Waiting for the toasts to auto-dismiss would work but costs seconds per
 * transition and is not reliable for action toasts, which stay until answered.
 * Dispatching on the button skips hit-testing and cannot hit the toast
 * instead. Visibility and enabled-ness are still asserted first, so this does
 * not paper over a control that is genuinely missing or disabled — only over
 * the overlay.
 *
 * NOTE: the overlap is a real UI observation, not only a test problem — a user
 * clicking quickly through these transitions can have the same click land on a
 * toast.
 */
export async function clickUnderToasts(target: Locator): Promise<void> {
  await expect(target).toBeVisible({ timeout: 30_000 });
  await expect(target).toBeEnabled({ timeout: 30_000 });
  await target.dispatchEvent("click");
}
