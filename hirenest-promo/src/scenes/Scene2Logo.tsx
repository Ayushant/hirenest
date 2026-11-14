import {
  AbsoluteFill,
  Audio,
  Easing,
  Interactive,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "../components/Backdrop";
import { inter, manrope, palette } from "../theme";

export const Scene2Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.25 * fps);

  const markScale = interpolate(frame, [0, 16], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.spring({ damping: 11 }),
    output: "perceptual-scale",
  });
  const markOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const wordmarkOpacity = interpolate(frame, [10, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const taglineOpacity = interpolate(frame, [36, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const taglineRise = interpolate(frame, [36, 54], [14, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: inter.fontFamily,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Audio src={staticFile("audio/scene_2.m4a")} from={leadIn} />
      <Backdrop tint={palette.brand} />

      <Interactive.Div
        name="Mark"
        style={{
          position: "relative",
          zIndex: 1,
          width: 110,
          height: 110,
          borderRadius: 26,
          background: `linear-gradient(140deg, ${palette.brand}, ${palette.teal})`,
          opacity: markOpacity,
          scale: markScale,
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 20px 60px ${palette.brand}55`,
        }}
      >
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 20V10.5L12 4l8 6.5V20h-5v-7H9v7H4z"
            fill={palette.navyDeep}
          />
        </svg>
      </Interactive.Div>

      <Interactive.Div
        name="Wordmark"
        style={{
          position: "relative",
          zIndex: 1,
          opacity: wordmarkOpacity,
          fontFamily: manrope.fontFamily,
          fontWeight: 800,
          fontSize: 76,
          letterSpacing: -1.5,
          color: palette.ink,
        }}
      >
        HireNest
        <span style={{ color: palette.teal }}>OS</span>
      </Interactive.Div>

      <Interactive.Div
        name="Tagline"
        style={{
          position: "relative",
          zIndex: 1,
          opacity: taglineOpacity,
          translate: `0px ${taglineRise}px`,
          marginTop: 18,
          fontSize: 32,
          fontWeight: 500,
          color: palette.inkSoft,
          textAlign: "center",
          maxWidth: 900,
        }}
      >
        One operating system for the entire staffing lifecycle.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
