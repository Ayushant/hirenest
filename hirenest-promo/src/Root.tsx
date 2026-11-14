import { Composition, Folder } from "remotion";
import { HireNestVideo } from "./HireNestVideo";
import { Scene1Problem } from "./scenes/Scene1Problem";
import { Scene2Logo } from "./scenes/Scene2Logo";
import { Scene3Flow } from "./scenes/Scene3Flow";
import { Scene4Vendor } from "./scenes/Scene4Vendor";
import { Scene5HQ } from "./scenes/Scene5HQ";
import { Scene6Candidate } from "./scenes/Scene6Candidate";
import { Scene7Compliance } from "./scenes/Scene7Compliance";
import { Scene8CTA } from "./scenes/Scene8CTA";
import { SCENES, TOTAL_FRAMES } from "./scenes/durations";

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HireNestOS-Promo"
        component={HireNestVideo}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={TOTAL_FRAMES}
      />
      <Folder name="Scenes">
        <Composition
          id="Scene1-Problem"
          component={Scene1Problem}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.problem}
        />
        <Composition
          id="Scene2-Logo"
          component={Scene2Logo}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.logo}
        />
        <Composition
          id="Scene3-Flow"
          component={Scene3Flow}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.flow}
        />
        <Composition
          id="Scene4-Vendor"
          component={Scene4Vendor}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.vendor}
        />
        <Composition
          id="Scene5-HQ"
          component={Scene5HQ}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.hq}
        />
        <Composition
          id="Scene6-Candidate"
          component={Scene6Candidate}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.candidate}
        />
        <Composition
          id="Scene7-Compliance"
          component={Scene7Compliance}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.compliance}
        />
        <Composition
          id="Scene8-CTA"
          component={Scene8CTA}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={SCENES.cta}
        />
      </Folder>
    </>
  );
};
