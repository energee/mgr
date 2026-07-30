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
 * ## Measurements
 *
 * Recorded when the helper was first written, and NOT re-run since: the
 * unpolled version failed 2 of 6 consecutive local runs of the packaging flow.
 * Treat that as the author's note, not a reproduced number.
 *
 * Reproduced on 2026-07-30 while reviewing this file: with the click OUTSIDE
 * the poll (see `pickComboboxOption`), the production-workflow chain failed 1
 * of 7 executions — 0/5 running that spec alone, 0/1 with three specs, 1/1 in
 * a full-suite run. With the click inside the poll, the full suite passed 3/3
 * and each new flow passed 3/3 (issue #437). Three runs is the acceptance bar,
 * not a proof of zero flake.
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

  // The WHOLE interaction is inside the retry, click included, and every step
  // carries its own short timeout. An earlier version polled only up to
  // "the option is visible" and then clicked outside the loop; that lost a
  // full-suite run (2026-07-30) with
  //   `locator.dispatchEvent: Test timeout of 90000ms exceeded.
  //    Call log: - waiting for getByRole('option', { name: '…6-Pack 437' })`
  // — the content unmounted in the window between the visibility assertion
  // passing and the dispatch resolving the element again. Outside the loop
  // there is no recovery from that, and an unbounded action call turns it
  // into a swallowed test budget instead of a retry: hence both the placement
  // and the explicit per-step timeouts.
  await expect(async () => {
    // Clear first: refilling identical text is a no-op for the underlying
    // input event, so a retry that did not change the value would not
    // re-trigger the filter that mounts the content.
    await input.fill("", { timeout: 5_000 });
    await input.fill(text, { timeout: 5_000 });
    await expect(option).toBeVisible({ timeout: 2_000 });

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
    await option.dispatchEvent("click", undefined, { timeout: 2_000 });

    // A committed selection closes the listbox. Asserting that (rather than
    // returning blind) keeps a silently-missed selection from surfacing later
    // as a confusing failure somewhere downstream — and it is what makes the
    // retry safe: the loop only exits once the selection actually took.
    await expect(option).toBeHidden({ timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
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
 * -> fulfil — where the author recorded it taking out one run in three. That
 * count was not re-measured during the 2026-07-30 review; what was measured is
 * that the order chain passed 6 of 6 executions WITH this helper in place.
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
 *
 * Unlike `pickComboboxOption` the dispatch is NOT retried, only bounded. A
 * transition button is replaced by the next action as soon as its click lands,
 * so a retry could not tell "the click never landed" from "it landed and the
 * button is gone" — and re-firing a transition is a real mutation. The 10s
 * bound only converts a detached-target hang into a fast, legible failure
 * instead of a swallowed test budget.
 */
export async function clickUnderToasts(target: Locator): Promise<void> {
  await expect(target).toBeVisible({ timeout: 30_000 });
  await expect(target).toBeEnabled({ timeout: 30_000 });
  await target.dispatchEvent("click", undefined, { timeout: 10_000 });
}
