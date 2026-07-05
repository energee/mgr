"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as LogOutIconHandle } from "@/components/icons/create-animated-icon";

const ARROW_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: {
    x: [0, 2, 0],
    transition: {
      duration: 0.4,
    },
  },
};

const DOOR_VARIANTS: Variants = {
  normal: { x: 0 },
  animate: {
    x: [0, -1, 0],
    transition: {
      duration: 0.4,
    },
  },
};

const LogOutIcon = createAnimatedIcon({
  displayName: "LogOutIcon",
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
          {/* Door frame */}
          <motion.path
            animate={controls}
            d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
            variants={DOOR_VARIANTS}
          />
          {/* Arrow */}
          <motion.g animate={controls} variants={ARROW_VARIANTS}>
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" x2="9" y1="12" y2="12" />
          </motion.g>
        </svg>
  ),
});

export { LogOutIcon };
