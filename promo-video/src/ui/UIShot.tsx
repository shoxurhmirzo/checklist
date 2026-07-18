import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";

const SRC_W = 3200;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Browser-style window that shows an animated crop (Ken Burns) of a
 * full-page app screenshot. Crop rects are in source-image pixels.
 */
export const UIShot: React.FC<{
  src: string;
  boxW: number;
  boxH: number;
  from: CropRect;
  to: CropRect;
  panStart?: number;
  panDuration: number;
  title?: string;
}> = ({ src, boxW, boxH, from, to, panStart = 0, panDuration, title = "checklist — localhost" }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [panStart, panStart + panDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const cx = interpolate(t, [0, 1], [from.x, to.x]);
  const cy = interpolate(t, [0, 1], [from.y, to.y]);
  const cw = interpolate(t, [0, 1], [from.w, to.w]);
  const ch = interpolate(t, [0, 1], [from.h, to.h]);

  const scale = boxW / cw;
  const imgLeft = (boxW - cw * scale) / 2 - cx * scale;
  const imgTop = (boxH - ch * scale) / 2 - cy * scale;

  return (
    <div
      style={{
        width: boxW,
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${colors.line}`,
        boxShadow: "0 34px 90px rgba(27,27,31,0.22)",
        backgroundColor: "#fff",
      }}
    >
      <div
        style={{
          height: 56,
          backgroundColor: colors.paper,
          borderBottom: `1px solid ${colors.line}`,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 10,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <div key={c} style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c }} />
        ))}
        <div
          style={{
            margin: "0 auto",
            fontFamily: fonts.ui,
            fontSize: 21,
            color: colors.inkSoft,
            backgroundColor: "#fff",
            border: `1px solid ${colors.line}`,
            borderRadius: 8,
            padding: "4px 26px",
          }}
        >
          {title}
        </div>
        <div style={{ width: 68 }} />
      </div>
      <div style={{ position: "relative", width: boxW, height: boxH, overflow: "hidden" }}>
        <Img
          src={staticFile(src)}
          style={{
            position: "absolute",
            width: SRC_W * scale,
            maxWidth: "none",
            left: imgLeft,
            top: imgTop,
          }}
        />
      </div>
    </div>
  );
};
