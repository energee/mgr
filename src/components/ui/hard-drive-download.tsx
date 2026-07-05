"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as HardDriveDownloadIconHandle } from "@/components/icons/create-animated-icon";

const ARROW_VARIANTS: Variants = {
  normal: { y: -1 },
  animate: {
    y: 0,
    transition: {
      type: "spring",
      stiffness: 200,
      damping: 10,
      mass: 1,
    },
  },
};

const HardDriveDownloadIcon = createAnimatedIcon({
  displayName: "HardDriveDownloadIcon",
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
        <rect height="8" rx="2" width="20" x="2" y="14" />
        <path d="M6 18h.01" />
        <path d="M10 18h.01" />
        <motion.g animate={controls} variants={ARROW_VARIANTS}>
          <path d="M12 2v8" />
          <path d="m16 6-4 4-4-4" />
        </motion.g>
      </svg>
  ),
});

export { HardDriveDownloadIcon };
