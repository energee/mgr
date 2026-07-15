/** User entity status actions must never fall back to generic direct writes. */

import { describe, expect, it } from "vitest";
import { userProfileEntity } from "../index";

describe("user profile account-status actions", () => {
  it("requires the dedicated per-record command for both status targets", () => {
    expect(userProfileEntity.stateMachine?.requiresAction).toEqual({
      inactive: "deactivate",
      active: "reactivate",
    });
  });

  it("does not expose status as an editable profile form field", () => {
    const statusField = userProfileEntity.sections
      ?.flatMap((section) => section.fields)
      .find((field) => field?.name === "status");
    expect(statusField).toMatchObject({ editable: false });
  });

  it("declares matching deactivate/reactivate actions", () => {
    expect(
      userProfileEntity.actions?.map(({ name, toState }) => ({ name, toState })),
    ).toEqual(
      expect.arrayContaining([
        { name: "deactivate", toState: "inactive" },
        { name: "reactivate", toState: "active" },
      ]),
    );
  });
});
