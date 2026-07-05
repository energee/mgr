/**
 * Characterization coverage for the animated-icon scaffold, written BEFORE
 * extracting `create-animated-icon.tsx` (backlog fix #1). These tests pin
 * down the shared contract every animated icon file implements today:
 *   - renders an <svg>
 *   - the forwardRef imperative handle's startAnimation/stopAnimation call
 *     into the underlying `useAnimation()` controller
 *   - uncontrolled hover (no ref attached) self-triggers the animation
 *   - `onMouseEnter`/`onMouseLeave` forwarding differs by file: the majority
 *     (flask, ship, settings, ...) only forward to the caller when a parent
 *     has taken control via ref; truck.tsx (and waves.tsx) forward
 *     unconditionally regardless of control state. TruckIcon here stands in
 *     for that divergent group.
 *
 * `motion/react` is mocked so assertions target OUR scaffold logic (which
 * variant name `controls.start()` is called with, and whether the
 * caller-supplied handler runs) rather than framer-motion's animation
 * engine, which is irrelevant to this refactor.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, createRef } from "react";
import { act } from "react";
import { setupRenderHarness } from "@/test/react-harness";

const mockStart = vi.hoisted(() => vi.fn());

vi.mock("motion/react", () => {
  const STRIP_KEYS = new Set([
    "animate",
    "variants",
    "initial",
    "transition",
    "custom",
  ]);
  const passthrough = (tag: string) =>
    function MotionMock(props: Record<string, unknown>) {
      const rest: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (!STRIP_KEYS.has(key)) rest[key] = props[key];
      }
      return createElement(tag, rest);
    };
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag) =>
          typeof tag === "string" ? passthrough(tag) : undefined,
      }
    ),
    useAnimation: () => ({
      start: mockStart,
      stop: vi.fn(),
      set: vi.fn(),
    }),
  };
});

import { FlaskIcon, type FlaskIconHandle } from "@/components/icons/flask";
import { ShipIcon, type ShipIconHandle } from "@/components/icons/ship";
import {
  SettingsIcon,
  type SettingsIconHandle,
} from "@/components/ui/settings";
import { TruckIcon, type TruckIconHandle } from "@/components/ui/truck";

const { render } = setupRenderHarness();

/** Fires a bubbling native "mouseover"/"mouseout" from outside `el`, which
 * is how React's onMouseEnter/onMouseLeave synthetic events are triggered
 * (they're implemented on top of mouseover/mouseout, not the native
 * non-bubbling mouseenter/mouseleave). */
function hover(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, relatedTarget: null })
    );
  });
}
function unhover(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: null })
    );
  });
}

beforeEach(() => {
  mockStart.mockClear();
});

describe.each([
  ["FlaskIcon", FlaskIcon],
  ["ShipIcon", ShipIcon],
  ["SettingsIcon", SettingsIcon],
])("%s (majority scaffold: forward only when ref-controlled)", (_name, Icon) => {
  it("renders an svg", () => {
    const c = render(createElement(Icon));
    expect(c.querySelector("svg")).not.toBeNull();
  });

  it("exposes a startAnimation/stopAnimation imperative handle when ref-controlled", () => {
    const ref = createRef<FlaskIconHandle | ShipIconHandle | SettingsIconHandle>();
    render(createElement(Icon, { ref }));

    act(() => ref.current!.startAnimation());
    expect(mockStart).toHaveBeenLastCalledWith("animate");

    act(() => ref.current!.stopAnimation());
    expect(mockStart).toHaveBeenLastCalledWith("normal");
  });

  it("uncontrolled hover self-triggers animation and does NOT forward onMouseEnter/onMouseLeave", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const c = render(createElement(Icon, { onMouseEnter, onMouseLeave }));
    const div = c.firstElementChild!;

    hover(div);
    expect(mockStart).toHaveBeenCalledWith("animate");
    expect(onMouseEnter).not.toHaveBeenCalled();

    unhover(div);
    expect(mockStart).toHaveBeenCalledWith("normal");
    expect(onMouseLeave).not.toHaveBeenCalled();
  });

  it("ref-controlled hover forwards onMouseEnter/onMouseLeave and does NOT self-trigger", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const ref = createRef<FlaskIconHandle | ShipIconHandle | SettingsIconHandle>();
    const c = render(createElement(Icon, { ref, onMouseEnter, onMouseLeave }));
    const div = c.firstElementChild!;

    hover(div);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();

    unhover(div);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
  });
});

describe("TruckIcon (divergent scaffold: forwards onMouseEnter/onMouseLeave unconditionally)", () => {
  it("renders an svg", () => {
    const c = render(createElement(TruckIcon));
    expect(c.querySelector("svg")).not.toBeNull();
  });

  it("exposes a startAnimation/stopAnimation imperative handle when ref-controlled", () => {
    const ref = createRef<TruckIconHandle>();
    render(createElement(TruckIcon, { ref }));

    act(() => ref.current!.startAnimation());
    expect(mockStart).toHaveBeenLastCalledWith("animate");

    act(() => ref.current!.stopAnimation());
    expect(mockStart).toHaveBeenLastCalledWith("normal");
  });

  it("uncontrolled hover BOTH self-triggers animation AND forwards onMouseEnter/onMouseLeave", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const c = render(createElement(TruckIcon, { onMouseEnter, onMouseLeave }));
    const div = c.firstElementChild!;

    hover(div);
    expect(mockStart).toHaveBeenCalledWith("animate");
    expect(onMouseEnter).toHaveBeenCalledTimes(1);

    unhover(div);
    expect(mockStart).toHaveBeenCalledWith("normal");
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  it("ref-controlled hover forwards onMouseEnter/onMouseLeave and does NOT self-trigger", () => {
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    const ref = createRef<TruckIconHandle>();
    const c = render(createElement(TruckIcon, { ref, onMouseEnter, onMouseLeave }));
    const div = c.firstElementChild!;

    hover(div);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();

    unhover(div);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    expect(mockStart).not.toHaveBeenCalled();
  });
});
