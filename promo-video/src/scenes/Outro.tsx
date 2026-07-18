import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts } from "../theme";
import { CheckMark } from "../ui/CheckMark";

const CLAIMS = ["Local-first.", "No sign-in.", "No cloud."];

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const boxIn = spring({
    frame: frame - 52,
    fps,
    config: { damping: 200 },
  });
  const checkProgress = interpolate(frame, [68, 86], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const settle = spring({
    frame: frame - 84,
    fps,
    config: { damping: 10, stiffness: 170, mass: 0.6 },
  });
  const titleIn = spring({ frame: frame - 78, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.ink,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: fonts.ui,
      }}
    >
      <div style={{ display: "flex", gap: 34, marginBottom: 70 }}>
        {CLAIMS.map((claim, i) => {
          const s = spring({
            frame: frame - 4 - i * 13,
            fps,
            config: { damping: 15, stiffness: 120 },
          });
          return (
            <div
              key={claim}
              style={{
                fontSize: 62,
                fontWeight: 700,
                color: colors.paper,
                opacity: s,
                transform: `translateY(${(1 - s) * 40}px)`,
              }}
            >
              {claim}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <div
          style={{
            width: 110,
            height: 110,
            borderRadius: 26,
            border: `5px solid ${colors.green}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: boxIn,
            transform: `scale(${(0.7 + boxIn * 0.3) * (1 + (1 - settle) * 0.12)})`,
            backgroundColor:
              checkProgress > 0 ? "rgba(47,158,68,0.12)" : "transparent",
          }}
        >
          <CheckMark size={72} progress={checkProgress} />
        </div>
        <div
          style={{
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: -3,
            color: colors.paper,
            opacity: titleIn,
            transform: `translateX(${(1 - titleIn) * 30}px)`,
          }}
        >
          Checklist
        </div>
      </div>

      <div
        style={{
          marginTop: 60,
          fontFamily: fonts.hand,
          fontSize: 50,
          color: "#b8b4a8",
          opacity: interpolate(frame, [100, 118], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Just you and your day.
      </div>
    </AbsoluteFill>
  );
};
