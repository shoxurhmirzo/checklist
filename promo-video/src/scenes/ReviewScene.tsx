import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Caption } from "../ui/Caption";
import { UIShot } from "../ui/UIShot";

export const ReviewScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shotIn = spring({ frame: frame - 4, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "flex-start",
        alignItems: "center",
        fontFamily: fonts.ui,
        paddingTop: 60,
      }}
    >
      <div style={{ opacity: shotIn, transform: `translateY(${(1 - shotIn) * 70}px)` }}>
        <UIShot
          src="ui-history.png"
          boxW={880}
          boxH={760}
          from={{ x: 740, y: 60, w: 1720, h: 1486 }}
          to={{ x: 740, y: 840, w: 1720, h: 1486 }}
          panStart={25}
          panDuration={115}
          title="daily history"
        />
      </div>
      <Caption from={80}>Every day writes its own record.</Caption>
    </AbsoluteFill>
  );
};
