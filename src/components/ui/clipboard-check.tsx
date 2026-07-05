"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as ClipboardCheckIconHandle } from "@/components/icons/create-animated-icon";

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 0,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.3, ease: "easeInOut" },
      opacity: { duration: 0.3, ease: "easeInOut" },
    },
  },
};

const ClipboardCheckIcon = createAnimatedIcon({
  displayName: "ClipboardCheckIcon",
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
        <rect height="4" rx="1" ry="1" width="8" x="8" y="2" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <motion.path
          animate={controls}
          d="m9 14 2 2 4-4"
          initial="normal"
          style={{ transformOrigin: "center" }}
          variants={CHECK_VARIANTS}
        />
      </svg>
  ),
});

export { ClipboardCheckIcon };
