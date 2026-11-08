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

const AXES = [
  { label: "Quality", value: 92 },
  { label: "Speed", value: 85 },
  { label: "Compliance", value: 97 },
  { label: "Retention", value: 78 },
  { label: "Responsiveness", value: 88 },
];

export const Scene4Vendor: React.FC = () => {
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
      <Audio src={staticFile("audio/scene_4.m4a")} from={leadIn} />
      <Backdrop tint={palette.teal} />

      <Interactive.Div
        name="Heading"
        style={{
          position: "absolute",
          top: 120,
          textAlign: "center",
          opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: `0px ${interpolate(frame, [0, 16], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px`,
        }}
      >
        <div style={{ fontSize: 46, fontWeight: 800, color: palette.ink, letterSpacing: -1 }}>
          For staffing vendors
        </div>
        <div style={{ fontSize: 26, fontWeight: 500, color: palette.inkSoft, marginTop: 8 }}>
          Matched candidates. De-duplicated pools. No black box.
        </div>
      </Interactive.Div>

      <Interactive.Div
        name="ScorecardPanel"
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: 60,
          width: 760,
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${palette.panelBorder}`,
          borderRadius: 20,
          padding: "32px 44px",
          opacity: interpolate(frame, [20, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ color: palette.ink, fontSize: 24, fontWeight: 700 }}>Vendor Scorecard</span>
          <span
            style={{
              background: palette.brandSoft,
              color: palette.sky,
              fontSize: 15,
              fontWeight: 700,
              padding: "6px 14px",
              borderRadius: 999,
            }}
          >
            SHA-256 Dedup Active
          </span>
        </div>

        {AXES.map((axis, i) => {
          const start = 30 + i * 8;
          const fillWidth = interpolate(frame, [start, start + 24], [0, axis.value], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          const rowOpacity = interpolate(frame, [start, start + 10], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div key={axis.label} style={{ opacity: rowOpacity, marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 17,
                  color: palette.inkSoft,
                  marginBottom: 6,
                  fontWeight: 600,
                }}
              >
                <span>{axis.label}</span>
                <span style={{ color: palette.ink }}>{Math.round(fillWidth)}</span>
              </div>
              <div
                style={{
                  height: 10,
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${fillWidth}%`,
                    borderRadius: 6,
                    background: `linear-gradient(90deg, ${palette.brand}, ${palette.teal})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </Interactive.Div>
    </AbsoluteFill>
  );
};
