"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface KeyboardIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface KeyboardIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const KeyboardIcon = forwardRef<KeyboardIconHandle, KeyboardIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
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
      </div>
    );
  }
);

KeyboardIcon.displayName = "KeyboardIcon";

export { KeyboardIcon };
