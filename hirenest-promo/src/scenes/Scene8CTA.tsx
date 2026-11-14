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

export const Scene8CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.25 * fps);

  const markScale = interpolate(frame, [0, 16], [0.75, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.spring({ damping: 11 }),
    output: "perceptual-scale",
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: inter.fontFamily,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Audio src={staticFile("audio/scene_8.m4a")} from={leadIn} />
      <Backdrop tint={palette.brand} />

      <Interactive.Div
        name="Mark"
        style={{
          position: "relative",
          zIndex: 1,
          width: 90,
          height: 90,
          borderRadius: 22,
          background: `linear-gradient(140deg, ${palette.brand}, ${palette.teal})`,
          scale: markScale,
          opacity: interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 20px 60px ${palette.brand}55`,
        }}
      >
        <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
          <path d="M4 20V10.5L12 4l8 6.5V20h-5v-7H9v7H4z" fill={palette.navyDeep} />
        </svg>
      </Interactive.Div>

      <Interactive.Div
        name="Wordmark"
        style={{
          position: "relative",
          zIndex: 1,
          fontFamily: manrope.fontFamily,
          fontWeight: 800,
          fontSize: 62,
          letterSpacing: -1.2,
          color: palette.ink,
          opacity: interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
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
          marginTop: 16,
          fontSize: 34,
          fontWeight: 600,
          color: palette.inkSoft,
          textAlign: "center",
          opacity: interpolate(frame, [26, 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: `0px ${interpolate(frame, [26, 42], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px`,
        }}
      >
        Staffing, finally, under one roof.
      </Interactive.Div>

      <Interactive.Div
        name="CTAButton"
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 44,
          padding: "16px 40px",
          borderRadius: 999,
          background: `linear-gradient(90deg, ${palette.brand}, ${palette.teal})`,
          color: palette.navyDeep,
          fontSize: 22,
          fontWeight: 700,
          opacity: interpolate(frame, [58, 76], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          scale: interpolate(frame, [58, 76], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 12 }),
            output: "perceptual-scale",
          }),
          boxShadow: `0 16px 40px ${palette.brand}44`,
        }}
      >
        Request Early Access
      </Interactive.Div>
    </AbsoluteFill>
  );
};
