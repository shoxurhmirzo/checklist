import React from "react";
import { AbsoluteFill } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Intro } from "./scenes/Intro";
import { GridScene } from "./scenes/GridScene";
import { PlanScene } from "./scenes/PlanScene";
import { SorterScene } from "./scenes/SorterScene";
import { ReviewScene } from "./scenes/ReviewScene";
import { Outro } from "./scenes/Outro";
import { Soundtrack } from "./Soundtrack";

export const DURATIONS = {
  intro: 105,
  grid: 175,
  plan: 175,
  sorter: 195,
  review: 160,
  outro: 150,
  transition: 15,
};

export const TOTAL_DURATION =
  DURATIONS.intro +
  DURATIONS.grid +
  DURATIONS.plan +
  DURATIONS.sorter +
  DURATIONS.review +
  DURATIONS.outro -
  DURATIONS.transition * 5;

const timing = linearTiming({ durationInFrames: DURATIONS.transition });

export const Promo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Soundtrack />
      <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={DURATIONS.intro}>
        <Intro />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={DURATIONS.grid}>
        <GridScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={DURATIONS.plan}>
        <PlanScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={DURATIONS.sorter}>
        <SorterScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={DURATIONS.review}>
        <ReviewScene />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={DURATIONS.outro}>
        <Outro />
      </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
