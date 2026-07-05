"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import type { Variants } from "motion/react";
import { AnimatePresence, motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as CalendarDaysIconHandle } from "@/components/icons/create-animated-icon";

const DOTS = [
  { cx: 8, cy: 14 },
  { cx: 12, cy: 14 },
  { cx: 16, cy: 14 },
  { cx: 8, cy: 18 },
  { cx: 12, cy: 18 },
  { cx: 16, cy: 18 },
];

const VARIANTS: Variants = {
  normal: {
    opacity: 1,
    transition: {
      duration: 0.2,
    },
  },
  animate: (i: number) => ({
    opacity: [1, 0.3, 1],
    transition: {
      delay: i * 0.1,
      duration: 0.4,
      times: [0, 0.5, 1],
    },
  }),
};

const CalendarDaysIcon = createAnimatedIcon({
  displayName: "CalendarDaysIcon",
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
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
        <path d="M3 10h18" />
        <AnimatePresence>
          {DOTS.map((dot, index) => (
            <motion.circle
              animate={controls}
              custom={index}
              cx={dot.cx}
              cy={dot.cy}
              fill="currentColor"
              initial="normal"
              key={`${dot.cx}-${dot.cy}`}
              r="1"
              stroke="none"
              variants={VARIANTS}
            />
          ))}
        </AnimatePresence>
      </svg>
  ),
});

export { CalendarDaysIcon };
