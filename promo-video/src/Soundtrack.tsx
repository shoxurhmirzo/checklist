import React from "react";
import { interpolate, Sequence, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { TOTAL_DURATION } from "./Promo";

const SFX = {
  whoosh: "https://remotion.media/whoosh.wav",
  whip: "https://remotion.media/whip.wav",
  pageTurn: "https://remotion.media/page-turn.wav",
  switch: "https://remotion.media/switch.wav",
  click: "https://remotion.media/mouse-click.wav",
  ding: "https://remotion.media/ding.wav",
};

// Scene start frames inside the TransitionSeries (transitions overlap by 15).
const GRID = 90;
const PLAN = 250;
const SORTER = 410;
const REVIEW = 590;
const OUTRO = 735;

interface Cue {
  at: number;
  src: string;
  volume: number;
}

const CUES: Cue[] = [
  // Intro: three words snapping in
  { at: 6, src: SFX.whip, volume: 0.4 },
  { at: 20, src: SFX.whip, volume: 0.4 },
  { at: 34, src: SFX.whip, volume: 0.4 },
  // Grid slides in like a sheet of paper
  { at: GRID, src: SFX.pageTurn, volume: 0.5 },
  { at: GRID + 140, src: SFX.ding, volume: 0.35 },
  // Plan view appears
  { at: PLAN + 14, src: SFX.switch, volume: 0.45 },
  // Sorter: one whip per card landing
  { at: SORTER + 34, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 52, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 70, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 88, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 106, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 124, src: SFX.whip, volume: 0.3 },
  { at: SORTER + 150, src: SFX.ding, volume: 0.4 },
  // Review cards
  { at: REVIEW + 4, src: SFX.pageTurn, volume: 0.45 },
  // Outro: checkbox gets checked
  { at: OUTRO + 2, src: SFX.whoosh, volume: 0.4 },
  { at: OUTRO + 70, src: SFX.click, volume: 0.5 },
  { at: OUTRO + 84, src: SFX.ding, volume: 0.5 },
];

export const Soundtrack: React.FC = () => {
  return (
    <>
      {/* Music: "Upbeat Forever" — Kevin MacLeod (incompetech.com), CC-BY 4.0 */}
      <Audio
        src={staticFile("music.mp3")}
        volume={(f) =>
          interpolate(
            f,
            [0, 30, TOTAL_DURATION - 60, TOTAL_DURATION - 5],
            [0, 0.22, 0.22, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        }
      />
      {CUES.map((cue, i) => (
        <Sequence key={i} from={cue.at}>
          <Audio src={cue.src} volume={cue.volume} />
        </Sequence>
      ))}
    </>
  );
};
