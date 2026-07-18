import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Caption } from "../ui/Caption";
import { UIShot } from "../ui/UIShot";

export const PlanScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "flex-start",
        alignItems: "center",
        fontFamily: fonts.ui,
        paddingTop: 48,
      }}
    >
      <div style={{ transform: `scale(${0.96 + cardIn * 0.04})`, opacity: cardIn }}>
        <UIShot
          src="ui-plan.png"
          boxW={1620}
          boxH={840}
          from={{ x: 560, y: 20, w: 2200, h: 1140 }}
          to={{ x: 620, y: 120, w: 1960, h: 1016 }}
          panStart={15}
          panDuration={140}
        />
      </div>
      <Caption from={38}>Brain-dump first. Think later.</Caption>
    </AbsoluteFill>
  );
};
