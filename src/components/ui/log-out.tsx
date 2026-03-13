"use client";

import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export type LogOutIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
}

type LogOutIconProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
}

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

const LogOutIcon = forwardRef<LogOutIconHandle, LogOutIconProps>(
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
      </div>
    );
  }
);

LogOutIcon.displayName = "LogOutIcon";

export { LogOutIcon };
