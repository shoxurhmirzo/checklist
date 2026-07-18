import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Caption } from "../ui/Caption";
import { UIShot } from "../ui/UIShot";

export const SorterScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const boardIn = spring({ frame, fps, config: { damping: 200 } });

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
      <div style={{ transform: `translateY(${(1 - boardIn) * 90}px)`, opacity: boardIn }}>
        <UIShot
          src="ui-sorter.png"
          boxW={1700}
          boxH={850}
          from={{ x: 160, y: 0, w: 2960, h: 1480 }}
          to={{ x: 1580, y: 330, w: 1600, h: 800 }}
          panStart={35}
          panDuration={130}
        />
      </div>
      <Caption from={128}>Sort by what matters — and what you'll actually do.</Caption>
    </AbsoluteFill>
  );
};
