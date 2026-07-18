import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";

export const Caption: React.FC<{ from: number; children: React.ReactNode }> = ({
  from,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - from, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: "absolute",
        bottom: 56,
        left: 0,
        right: 0,
        textAlign: "center",
        fontFamily: fonts.hand,
        fontSize: 54,
        fontWeight: 700,
        color: colors.ink,
        opacity: s,
        transform: `translateY(${(1 - s) * 30}px)`,
      }}
    >
      {children}
    </div>
  );
};
