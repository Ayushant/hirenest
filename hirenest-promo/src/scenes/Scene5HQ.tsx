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

const KPIS = [
  { label: "Deterministic Matching", value: "100% scored" },
  { label: "SLA Tracking", value: "48h shortlist" },
  { label: "Dispute Resolution", value: "Audited" },
];

export const Scene5HQ: React.FC = () => {
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
      <Audio src={staticFile("audio/scene_5.m4a")} from={leadIn} />
      <Backdrop tint={palette.brand} />

      <Interactive.Div
        name="Heading"
        style={{
          position: "absolute",
          top: 120,
          textAlign: "center",
          opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <div style={{ fontSize: 46, fontWeight: 800, color: palette.ink, letterSpacing: -1 }}>
          Full visibility for HQ
        </div>
        <div style={{ fontSize: 26, fontWeight: 500, color: palette.inkSoft, marginTop: 8 }}>
          Every requirement, every vendor, every SLA — one pane of glass.
        </div>
      </Interactive.Div>

      <div style={{ display: "flex", gap: 28, marginTop: 70 }}>
        {KPIS.map((kpi, i) => {
          const start = 22 + i * 10;
          const opacity = interpolate(frame, [start, start + 16], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          const rise = interpolate(frame, [start, start + 16], [26, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          return (
            <Interactive.Div
              key={kpi.label}
              name={`KPI-${i}`}
              style={{
                position: "relative",
                zIndex: 1,
                opacity,
                translate: `0px ${rise}px`,
                width: 260,
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${palette.panelBorder}`,
                borderRadius: 18,
                padding: "28px 26px",
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: palette.brandSoft,
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div style={{ width: 16, height: 16, borderRadius: 4, background: palette.sky }} />
              </div>
              <div style={{ color: palette.ink, fontSize: 20, fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>
                {kpi.label}
              </div>
              <div style={{ color: palette.teal, fontSize: 17, fontWeight: 600 }}>{kpi.value}</div>
            </Interactive.Div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
