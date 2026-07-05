"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as ChartBarIncreasingIconHandle } from "@/components/icons/create-animated-icon";

const LINE_VARIANTS: Variants = {
  visible: { pathLength: 1, opacity: 1 },
  hidden: { pathLength: 0, opacity: 0 },
};

const ChartBarIncreasingIcon = createAnimatedIcon({
  displayName: "ChartBarIncreasingIcon",
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
          custom={1}
          d="M7 11h8"
          initial="visible"
          variants={LINE_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={2}
          d="M7 16h12"
          initial="visible"
          variants={LINE_VARIANTS}
        />
        <motion.path
          animate={controls}
          custom={0}
          d="M7 6h3"
          initial="visible"
          variants={LINE_VARIANTS}
        />
      </svg>
  ),
  // Custom two-phase stagger (variants only define visible/hidden, no
  // "animate" key): fade the lines out per-index, then redraw them.
  startSequence: async (controls) => {
    await controls.start((i) => ({
      pathLength: 0,
      opacity: 0,
      transition: { delay: i * 0.1, duration: 0.3 },
    }));
    await controls.start((i) => ({
      pathLength: 1,
      opacity: 1,
      transition: { delay: i * 0.1, duration: 0.3 },
    }));
  },
  stopSequence: (controls) => controls.start("visible"),
});

export { ChartBarIncreasingIcon };
