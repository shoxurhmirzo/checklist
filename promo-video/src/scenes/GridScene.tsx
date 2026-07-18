import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Caption } from "../ui/Caption";
import { UIShot } from "../ui/UIShot";

export const GridScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paperDeep,
        justifyContent: "flex-start",
        alignItems: "center",
        fontFamily: fonts.ui,
        paddingTop: 48,
      }}
    >
      <div style={{ transform: `translateY(${(1 - cardIn) * 120}px)`, opacity: cardIn }}>
        <UIShot
          src="ui-checklist.png"
          boxW={1700}
          boxH={850}
          from={{ x: 40, y: 20, w: 3120, h: 1560 }}
          to={{ x: 40, y: 1080, w: 3120, h: 1560 }}
          panStart={30}
          panDuration={120}
        />
      </div>
      <Caption from={95}>Every day of the month, on one sheet.</Caption>
    </AbsoluteFill>
  );
};
