"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as ChartLineIconHandle } from "@/components/icons/create-animated-icon";

const VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      delay: 0.15,
      duration: 0.3,
      opacity: { delay: 0.1 },
    },
  },
};

const ChartLineIcon = createAnimatedIcon({
  displayName: "ChartLineIcon",
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
          <path d="M3 3v16a2 2 0 0 0 2 2h16" />
          <motion.path
            animate={controls}
            d="m7 13 3-3 4 4 5-5"
            variants={VARIANTS}
          />
        </svg>
  ),
});

export { ChartLineIcon };
