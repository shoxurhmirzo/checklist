import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";
import { colors, fonts } from "../theme";

const WORDS = [
  { text: "Plan.", color: colors.ink },
  { text: "Do.", color: colors.green },
  { text: "Review.", color: colors.ink },
];

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const subtitleIn = spring({
    frame: frame - 55,
    fps,
    config: { damping: 200 },
  });

  const paperShift = interpolate(frame, [0, 105], [0, -14], {
    easing: Easing.bezier(0.4, 0, 0.6, 1),
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.paper,
        justifyContent: "center",
        alignItems: "center",
        fontFamily: fonts.ui,
      }}
    >
      <Ruling />
      <div style={{ transform: `translateY(${paperShift}px)`, textAlign: "center" }}>
        <div style={{ display: "flex", gap: 44, justifyContent: "center" }}>
          {WORDS.map((word, i) => {
            const s = spring({
              frame: frame - 6 - i * 14,
              fps,
              config: { damping: 14, stiffness: 130, mass: 0.9 },
            });
            return (
              <div
                key={word.text}
                style={{
                  fontSize: 148,
                  fontWeight: 800,
                  letterSpacing: -4,
                  color: word.color,
                  transform: `translateY(${(1 - s) * 90}px) scale(${0.9 + s * 0.1})`,
                  opacity: s,
                }}
              >
                {word.text}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 34,
            fontSize: 40,
            fontWeight: 500,
            color: colors.inkSoft,
            opacity: subtitleIn,
            transform: `translateY(${(1 - subtitleIn) * 24}px)`,
          }}
        >
          One sheet for your whole month — on paper, but smarter.
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Ruling: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 25], [0, 0.55], {
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ opacity }}>
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 80 + i * 72,
            left: 0,
            right: 0,
            height: 1,
            backgroundColor: colors.line,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 150,
          width: 2,
          backgroundColor: "#e5b8b0",
          opacity: 0.7,
        }}
      />
    </AbsoluteFill>
  );
};
