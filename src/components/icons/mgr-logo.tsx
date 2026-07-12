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
      role="img"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <title>MGR</title>
      {/* Filled unitank body with porthole cut-out (evenodd) */}
      <path
        fillRule="evenodd"
        fill="currentColor"
        d="M4.5 8.3C4.5 5.1 7 2.7 10.2 2.7H13.8C17 2.7 19.5 5.1 19.5 8.3V13.6L13.1 20.6C12.5 21.25 11.5 21.25 10.9 20.6L4.5 13.6V8.3ZM12 6.7A2.1 2.1 0 1 0 12 10.9A2.1 2.1 0 1 0 12 6.7Z"
      />
      {/* Support legs */}
      <path
        d="M5.2 14.5V20.3M18.8 14.5V20.3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
};
