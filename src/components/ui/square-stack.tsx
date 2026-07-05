"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as SquareStackIconHandle } from "@/components/icons/create-animated-icon";

const RECT_VARIANTS: Variants = {
  normal: { scale: 1 },
  animate: {
    scale: [1, 0.8, 1],
    transition: { duration: 0.4 },
  },
};

const PATH_VARIANTS: Variants = {
  normal: { scale: 1 },
  animate: {
    scale: [1, 0.9, 1],
  },
};

const SquareStackIcon = createAnimatedIcon({
  displayName: "SquareStackIcon",
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
            d="M4 10c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2"
            transition={{
              delay: 0.3,
              duration: 0.4,
            }}
            variants={PATH_VARIANTS}
          />
          <motion.path
            animate={controls}
            d="M10 16c-1.1 0-2-.9-2-2v-4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2"
            transition={{
              delay: 0.2,
              duration: 0.2,
            }}
            variants={PATH_VARIANTS}
          />
          <motion.rect
            animate={controls}
            height="8"
            rx="2"
            variants={RECT_VARIANTS}
            width="8"
            x="14"
            y="14"
          />
        </svg>
  ),
});

export { SquareStackIcon };
