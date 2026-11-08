import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { Scene1Problem } from "./scenes/Scene1Problem";
import { Scene2Logo } from "./scenes/Scene2Logo";
import { Scene3Flow } from "./scenes/Scene3Flow";
import { Scene4Vendor } from "./scenes/Scene4Vendor";
import { Scene5HQ } from "./scenes/Scene5HQ";
import { Scene6Candidate } from "./scenes/Scene6Candidate";
import { Scene7Compliance } from "./scenes/Scene7Compliance";
import { Scene8CTA } from "./scenes/Scene8CTA";
import { SCENES, TRANSITION_FRAMES } from "./scenes/durations";

export const HireNestVideo: React.FC = () => {
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Problem" durationInFrames={SCENES.problem}>
        <Scene1Problem />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="Logo" durationInFrames={SCENES.logo}>
        <Scene2Logo />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="Flow" durationInFrames={SCENES.flow}>
        <Scene3Flow />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="Vendor" durationInFrames={SCENES.vendor}>
        <Scene4Vendor />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="HQ" durationInFrames={SCENES.hq}>
        <Scene5HQ />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="Candidate" durationInFrames={SCENES.candidate}>
        <Scene6Candidate />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="Compliance" durationInFrames={SCENES.compliance}>
        <Scene7Compliance />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition
        presentation={fade()}
        timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
      />
      <TransitionSeries.Sequence name="CTA" durationInFrames={SCENES.cta}>
        <Scene8CTA />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
