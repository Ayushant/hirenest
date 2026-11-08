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
import { inter, palette } from "../theme";

const BADGES = ["DPDP Act 2023", "Row-Level Security", "Tenant Isolation", "Audit Logging"];

export const Scene7Compliance: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.3 * fps);

  const shieldScale = interpolate(frame, [0, 16], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.spring({ damping: 11 }),
    output: "perceptual-scale",
  });
  const shieldOpacity = interpolate(frame, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: inter.fontFamily,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Audio src={staticFile("audio/scene_7.m4a")} from={leadIn} />
      <Backdrop tint={palette.amber} />

      <Interactive.Div
        name="Shield"
        style={{
          position: "relative",
          zIndex: 1,
          scale: shieldScale,
          opacity: shieldOpacity,
          width: 96,
          height: 96,
          borderRadius: 24,
          background: `linear-gradient(140deg, ${palette.amber}, ${palette.brand})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 32,
          boxShadow: `0 18px 50px ${palette.amber}44`,
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
            fill={palette.navyDeep}
          />
        </svg>
      </Interactive.Div>

      <Interactive.Div
        name="Heading"
        style={{
          position: "relative",
          zIndex: 1,
          fontSize: 48,
          fontWeight: 800,
          color: palette.ink,
          letterSpacing: -1,
          marginBottom: 36,
          opacity: interpolate(frame, [10, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Built for India. Enterprise-grade.
      </Interactive.Div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", maxWidth: 1000 }}>
        {BADGES.map((badge, i) => {
          const start = 22 + i * 9;
          const opacity = interpolate(frame, [start, start + 14], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          const scale = interpolate(frame, [start, start + 14], [0.85, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 12 }),
            output: "perceptual-scale",
          });
          return (
            <Interactive.Div
              key={badge}
              name={`Badge-${i}`}
              style={{
                position: "relative",
                zIndex: 1,
                opacity,
                scale,
                padding: "16px 28px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                border: `1px solid ${palette.panelBorder}`,
                color: palette.ink,
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              {badge}
            </Interactive.Div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
