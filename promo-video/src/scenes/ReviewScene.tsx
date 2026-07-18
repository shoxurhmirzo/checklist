import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { Caption } from "../ui/Caption";
import { UIShot } from "../ui/UIShot";

export const ReviewScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leftIn = spring({ frame: frame - 4, fps, config: { damping: 200 } });
  const rightIn = spring({ frame: frame - 16, fps, config: { damping: 200 } });

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
      <div style={{ display: "flex", gap: 44 }}>
        <div style={{ opacity: leftIn, transform: `translateY(${(1 - leftIn) * 70}px)` }}>
          <UIShot
            src="ui-sleep.png"
            boxW={880}
            boxH={760}
            from={{ x: 820, y: 100, w: 1560, h: 1348 }}
            to={{ x: 850, y: 120, w: 1480, h: 1279 }}
            panStart={20}
            panDuration={110}
            title="sleep log"
          />
        </div>
        <div style={{ opacity: rightIn, transform: `translateY(${(1 - rightIn) * 70}px)` }}>
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
      </div>
      <Caption from={80}>Every day writes its own record. Sleep included.</Caption>
    </AbsoluteFill>
  );
};
