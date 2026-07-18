import React from "react";
import { colors } from "../theme";

export const CheckMark: React.FC<{ size?: number; color?: string; progress?: number }> = ({
  size = 30,
  color = colors.green,
  progress = 1,
}) => {
  const length = 40;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12.5 L9.5 18 L20 6.5"
        stroke={color}
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - progress)}
      />
    </svg>
  );
};
