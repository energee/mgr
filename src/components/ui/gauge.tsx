"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Transition } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as GaugeIconHandle } from "@/components/icons/create-animated-icon";

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 160,
  damping: 17,
  mass: 1,
};

const GaugeIcon = createAnimatedIcon({
  displayName: "GaugeIcon",
  renderSvg: ({ controls, size }) => (
    <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          <motion.path
            animate={controls}
            d="m12 14 4-4"
            transition={DEFAULT_TRANSITION}
            variants={{
              animate: { translateX: 0.5, translateY: 3, rotate: 72 },
              normal: {
                translateX: 0,
                rotate: 0,
                translateY: 0,
              },
            }}
          />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
  ),
});

export { GaugeIcon };
