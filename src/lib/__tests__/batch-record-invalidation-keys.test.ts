/**
 * Regression pin for batchRecordInvalidationKeys (issue #560).
 *
 * The tautological key-factory suite was deleted in the A3 lib cleanup, but
 * this one test asserts real QueryClient behavior: the unified batch detail
 * page caches the record under the batches_with_brew_info view key
 * (detailQueryOptions + viewTable), and invalidating batchKeys.detail alone
 * left the status badge stale. Keep this pin so the helper always covers
 * every cache the batch record lives in.
 */

import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  batchRecordInvalidationKeys,
  batchKeys,
  entityKeys,
} from "../query-keys";

describe("batchRecordInvalidationKeys", () => {
  it("covers every cache the batch record lives in, including the unified detail's view key", async () => {
    const queryClient = new QueryClient();
    const id = "abc-123";
    queryClient.setQueryData(entityKeys.detail("batches_with_brew_info", id), {
      status: "brewing",
    });
    queryClient.setQueryData(batchKeys.detail(id), { status: "brewing" });

    for (const key of batchRecordInvalidationKeys(id)) {
      await queryClient.invalidateQueries({ queryKey: key });
    }

    expect(
      queryClient.getQueryState(entityKeys.detail("batches_with_brew_info", id))
        ?.isInvalidated
    ).toBe(true);
    expect(queryClient.getQueryState(batchKeys.detail(id))?.isInvalidated).toBe(
      true
    );
  });
});
