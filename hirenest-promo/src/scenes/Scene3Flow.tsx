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

type NodeKey = "client" | "hq" | "vendor";

const NODES: Record<NodeKey, { x: number; y: number; label: string; color: string }> = {
  client: { x: 140, y: 240, label: "Client", color: palette.sky },
  hq: { x: 480, y: 90, label: "HQ", color: palette.brand },
  vendor: { x: 820, y: 240, label: "Vendor", color: palette.teal },
};

const EDGES: { from: NodeKey; to: NodeKey; label: string; delay: number }[] = [
  { from: "client", to: "hq", label: "Requirement", delay: 6 },
  { from: "hq", to: "vendor", label: "Assignment", delay: 46 },
];

export const Scene3Flow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.3 * fps);

  return (
    <AbsoluteFill style={{ fontFamily: inter.fontFamily }}>
      <Audio src={staticFile("audio/scene_3.m4a")} from={leadIn} />
      <Backdrop tint={palette.sky} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Interactive.Div
          name="GraphPanel"
          style={{
            position: "relative",
            zIndex: 1,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 24,
            padding: "40px 60px 20px",
            opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          <svg width="960" height="340" viewBox="0 0 960 340">
            {EDGES.map((e, i) => {
              const a = NODES[e.from];
              const b = NODES[e.to];
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              const progress = interpolate(frame, [e.delay, e.delay + 20], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              });
              const labelOpacity = interpolate(frame, [e.delay + 16, e.delay + 28], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={i}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={palette.panelBorder}
                    strokeWidth={3}
                  />
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={b.color}
                    strokeWidth={3}
                    strokeDasharray={len}
                    strokeDashoffset={len * (1 - progress)}
                  />
                  <rect x={mx - 68} y={my - 18} width={136} height={36} rx={18} fill={palette.navy} opacity={labelOpacity} />
                  <text
                    x={mx}
                    y={my + 5}
                    textAnchor="middle"
                    fontSize={18}
                    fontFamily={inter.fontFamily}
                    fontWeight={600}
                    fill={palette.inkSoft}
                    opacity={labelOpacity}
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}

            {(Object.entries(NODES) as [NodeKey, (typeof NODES)[NodeKey]][]).map(
              ([key, node], i) => {
                const pop = interpolate(frame, [i * 4, i * 4 + 12], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                  easing: Easing.spring({ damping: 10 }),
                  output: "perceptual-scale",
                });
                return (
                  <g key={key} style={{ scale: pop, transformOrigin: `${node.x}px ${node.y}px` } as any}>
                    <circle cx={node.x} cy={node.y} r={34} fill={palette.navy} stroke={node.color} strokeWidth={3} />
                    <circle cx={node.x} cy={node.y} r={10} fill={node.color} />
                    <text
                      x={node.x}
                      y={node.y + 64}
                      textAnchor="middle"
                      fontSize={24}
                      fontFamily={inter.fontFamily}
                      fontWeight={700}
                      fill={palette.ink}
                    >
                      {node.label}
                    </text>
                  </g>
                );
              }
            )}
          </svg>
        </Interactive.Div>

        <Interactive.Div
          name="Caption"
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: 36,
            textAlign: "center",
            opacity: interpolate(frame, [70, 90], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            color: palette.ink,
            fontSize: 42,
            fontWeight: 700,
            maxWidth: 1000,
          }}
        >
          Post a requirement once. Route it instantly.
          <div style={{ fontSize: 26, fontWeight: 500, color: palette.inkSoft, marginTop: 10 }}>
            No blind blast lists — ever.
          </div>
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
