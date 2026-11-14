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

const STEPS = ["Applied", "Shortlisted", "Interview", "Offer"];

export const Scene6Candidate: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.3 * fps);

  return (
    <AbsoluteFill
      style={{
        fontFamily: inter.fontFamily,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Audio src={staticFile("audio/scene_6.m4a")} from={leadIn} />
      <Backdrop tint={palette.sky} />

      <Interactive.Div
        name="Heading"
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          marginBottom: 56,
          opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ fontSize: 46, fontWeight: 800, color: palette.ink, letterSpacing: -1 }}>
          Real-time status for candidates
        </div>
        <div style={{ fontSize: 26, fontWeight: 500, color: palette.inkSoft, marginTop: 8 }}>
          No more silence after you apply.
        </div>
      </Interactive.Div>

      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {STEPS.map((step, i) => {
          const start = 20 + i * 14;
          const dotScale = interpolate(frame, [start, start + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 9 }),
            output: "perceptual-scale",
          });
          const labelOpacity = interpolate(frame, [start, start + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const lineProgress =
            i > 0
              ? interpolate(frame, [start - 10, start], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 1;
          return (
            <div key={step} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && (
                <div
                  style={{
                    width: 110,
                    height: 4,
                    background: "rgba(255,255,255,0.1)",
                    position: "relative",
                    borderRadius: 2,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${lineProgress * 100}%`,
                      background: `linear-gradient(90deg, ${palette.brand}, ${palette.teal})`,
                      borderRadius: 2,
                    }}
                  />
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 150 }}>
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    scale: dotScale,
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: `linear-gradient(140deg, ${palette.brand}, ${palette.teal})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 10px 30px ${palette.brand}44`,
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12l5 5L20 6" stroke={palette.navyDeep} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div
                  style={{
                    position: "relative",
                    zIndex: 1,
                    opacity: labelOpacity,
                    marginTop: 14,
                    color: palette.ink,
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  {step}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
