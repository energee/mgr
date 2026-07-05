"use client";

// Animated icon built on the shared scaffold in create-animated-icon.tsx
// (imperative start/stopAnimation handle, hover-to-animate, ref-controlled
// event forwarding). This file only supplies the unique SVG + variants.
import { motion } from "motion/react";

import { createAnimatedIcon } from "@/components/icons/create-animated-icon";

export type { IconHandle as KeyboardIconHandle } from "@/components/icons/create-animated-icon";

const KeyboardIcon = createAnimatedIcon({
  displayName: "KeyboardIcon",
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
          {/* Keyboard outline */}
          <rect width="20" height="16" x="2" y="4" rx="2" ry="2" />
          {/* Space bar */}
          <path d="M6 16h12" />
          {/* Key rows - animate on hover */}
          <motion.g
            animate={controls}
            variants={{
              normal: { y: 0 },
              animate: { y: [0, -1, 0] },
            }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <line x1="6" y1="8" x2="6" y2="8" strokeLinecap="round" strokeWidth="2.5" />
            <line x1="10" y1="8" x2="10" y2="8" strokeLinecap="round" strokeWidth="2.5" />
            <line x1="14" y1="8" x2="14" y2="8" strokeLinecap="round" strokeWidth="2.5" />
            <line x1="18" y1="8" x2="18" y2="8" strokeLinecap="round" strokeWidth="2.5" />
          </motion.g>
          <motion.g
            animate={controls}
            variants={{
              normal: { y: 0 },
              animate: { y: [0, -1, 0] },
            }}
            transition={{ duration: 0.3, delay: 0.1, ease: "easeInOut" }}
          >
            <line x1="8" y1="12" x2="8" y2="12" strokeLinecap="round" strokeWidth="2.5" />
            <line x1="12" y1="12" x2="12" y2="12" strokeLinecap="round" strokeWidth="2.5" />
            <line x1="16" y1="12" x2="16" y2="12" strokeLinecap="round" strokeWidth="2.5" />
          </motion.g>
        </svg>
  ),
});

export { KeyboardIcon };
