import React from "react";

type MGRIconProps = {
  className?: string;
  size?: number;
}

export const MGRIcon: React.FC<MGRIconProps> = ({
  className = "",
  size = 24,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <title>MGR</title>
      {/* Unitank body with rounded top and conical bottom */}
      <path d="M5 7C5 5.9 5.9 5 7 5L17 5C18.1 5 19 5.9 19 7L19 15L12 22L5 15L5 7" />
      {/* Support legs */}
      <line x1="6" y1="17" x2="6" y2="21" />
      <line x1="18" y1="17" x2="18" y2="21" />
    </svg>
  );
};
