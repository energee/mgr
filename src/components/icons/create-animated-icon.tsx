"use client";

/**
 * Factory for the animated icon components used throughout the app
 * (src/components/icons/{flask,ship}.tsx plus ~48 files under
 * src/components/ui/*.tsx). Every one of them previously hand-rolled an
 * identical scaffold: a `forwardRef` wrapper exposing an imperative
 * `{ startAnimation, stopAnimation }` handle, a `useAnimation()` controller,
 * hover-triggered animation when the caller hasn't taken control via ref,
 * and a `<div>` wrapper around the icon's unique `<svg>`. This factory
 * captures that scaffold once so each icon file only supplies its unique
 * SVG markup/variants via `renderSvg`.
 *
 * Scaffold behaviors known to diverge across the icon set are exposed as
 * explicit options rather than silently normalized:
 *   - `forwardMouseEvents`: most icons forward `onMouseEnter`/`onMouseLeave`
 *     to the caller only once a parent has taken control via ref
 *     (`"when-controlled"`, the default). `waves.tsx` and `truck.tsx`
 *     forward unconditionally, even while uncontrolled (`"always"`).
 *   - `classNameStrategy`: most icons run `className` through `cn()`
 *     (`"cn"`, the default). `truck.tsx` passes it straight through
 *     (`"raw"`).
 *   - `startSequence`/`stopSequence`: layers.tsx and the two
 *     chart-*-increasing icons run custom animation sequences instead of
 *     the generic `controls.start("animate")`/`controls.start("normal")`
 *     (their variants don't even define those keys).
 * Every migrated icon file passes the option matching its pre-refactor
 * behavior exactly — this factory does not change any icon's runtime
 * behavior.
 *
 * See src/components/icons/animated.tsx for the `wrap()` helper that
 * further wraps these into the `Animated*` components consumed by the rest
 * of the app.
 */
import { useAnimation } from "motion/react";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export type IconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

export type IconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

// framer-motion doesn't export the return type of useAnimation() (internally
// `LegacyAnimationControls`) — derive it structurally instead of naming it.
type AnimationControls = ReturnType<typeof useAnimation>;

type RenderSvg = (args: {
  controls: AnimationControls;
  size: number;
}) => ReactNode;

type CreateAnimatedIconOptions = {
  /** Assigned to the generated component's `displayName` (shows up in
   * React DevTools and error stacks in place of the old per-file name). */
  displayName: string;
  /** Renders the icon's unique `<svg>`, given the shared animation
   * controls and the resolved `size` prop. */
  renderSvg: RenderSvg;
  /** See module doc above. Defaults to the majority ("when-controlled") behavior. */
  forwardMouseEvents?: "when-controlled" | "always";
  /** See module doc above. Defaults to the majority ("cn") behavior. */
  classNameStrategy?: "cn" | "raw";
  /**
   * Escape hatch for icons whose start animation is NOT the generic
   * `controls.start("animate")` — layers.tsx sequentially awaits
   * "firstState" then "secondState", and the two chart-*-increasing icons
   * run a two-phase per-index stagger via `controls.start((i) => ...)`.
   * Runs on BOTH the imperative `startAnimation()` handle and uncontrolled
   * hover-enter, matching the pre-factory files (the custom sequence
   * appeared verbatim in both paths).
   */
  startSequence?: (controls: AnimationControls) => void | Promise<void>;
  /**
   * Stop-side escape hatch — the chart-*-increasing icons reset with
   * `controls.start("visible")`, not "normal". Runs on both the imperative
   * `stopAnimation()` handle and uncontrolled hover-leave.
   */
  stopSequence?: (controls: AnimationControls) => void | Promise<void>;
};

export function createAnimatedIcon({
  displayName,
  renderSvg,
  forwardMouseEvents = "when-controlled",
  classNameStrategy = "cn",
  startSequence,
  stopSequence,
}: CreateAnimatedIconOptions) {
  // Default sequences reproduce the generic scaffold shared by ~47 of the
  // 50 icons; the escape hatches above override per icon.
  const runStart = (controls: AnimationControls) =>
    startSequence ? startSequence(controls) : controls.start("animate");
  const runStop = (controls: AnimationControls) =>
    stopSequence ? stopSequence(controls) : controls.start("normal");

  const Icon = forwardRef<IconHandle, IconProps>(
    ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
      const controls = useAnimation();
      const isControlledRef = useRef(false);

      useImperativeHandle(ref, () => {
        isControlledRef.current = true;

        return {
          startAnimation: () => void runStart(controls),
          stopAnimation: () => void runStop(controls),
        };
      });

      const handleMouseEnter = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
          if (forwardMouseEvents === "always") {
            if (!isControlledRef.current) {
              void runStart(controls);
            }
            onMouseEnter?.(e);
          } else if (isControlledRef.current) {
            onMouseEnter?.(e);
          } else {
            void runStart(controls);
          }
        },
        [controls, onMouseEnter]
      );

      const handleMouseLeave = useCallback(
        (e: MouseEvent<HTMLDivElement>) => {
          if (forwardMouseEvents === "always") {
            if (!isControlledRef.current) {
              void runStop(controls);
            }
            onMouseLeave?.(e);
          } else if (isControlledRef.current) {
            onMouseLeave?.(e);
          } else {
            void runStop(controls);
          }
        },
        [controls, onMouseLeave]
      );

      return (
        <div
          className={classNameStrategy === "cn" ? cn(className) : className}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          {...props}
        >
          {renderSvg({ controls, size })}
        </div>
      );
    }
  );

  Icon.displayName = displayName;
  return Icon;
}
