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

const CHAOS_ITEMS = [
  { text: "Spreadsheets.xlsx", x: 10, y: 18, delay: 2 },
  { text: "\"Any update on this?\" — WhatsApp", x: 54, y: 10, delay: 10 },
  { text: "Follow-up #14", x: 8, y: 72, delay: 18 },
  { text: "Who has this candidate?", x: 50, y: 78, delay: 26 },
  { text: "CC'd on 9 emails", x: 30, y: 46, delay: 34 },
];

export const Scene1Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const leadIn = Math.round(0.3 * fps);

  const headlineStart = 70;

  return (
    <AbsoluteFill style={{ fontFamily: inter.fontFamily }}>
      <Audio src={staticFile("audio/scene_1.m4a")} from={leadIn} />
      <Backdrop tint={palette.rose} />

      {CHAOS_ITEMS.map((item, i) => {
        const appear = interpolate(
          frame,
          [item.delay, item.delay + 12, headlineStart - 4, headlineStart + 10],
          [0, 1, 1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }
        );
        const rise = interpolate(frame, [item.delay, item.delay + 12], [16, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        return (
          <Interactive.Div
            key={i}
            name={`Chaos-${i}`}
            style={{
              position: "absolute",
              left: `${item.x}%`,
              top: `${item.y}%`,
              opacity: appear,
              translate: `0px ${rise}px`,
              background: "rgba(255,255,255,0.06)",
              border: `1px solid ${palette.panelBorder}`,
              borderRadius: 10,
              padding: "14px 20px",
              color: palette.inkSoft,
              fontSize: 26,
              fontWeight: 500,
              backdropFilter: "blur(6px)",
              maxWidth: 420,
            }}
          >
            {item.text}
          </Interactive.Div>
        );
      })}

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "0 140px",
        }}
      >
        <Interactive.Div
          name="Headline"
          style={{
            position: "relative",
            zIndex: 1,
            opacity: interpolate(
              frame,
              [headlineStart, headlineStart + 18],
              [0, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
              }
            ),
            scale: interpolate(
              frame,
              [headlineStart, headlineStart + 18],
              [0.94, 1],
              {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 200 }),
                output: "perceptual-scale",
              }
            ),
            textAlign: "center",
            color: palette.ink,
            fontSize: 86,
            fontWeight: 800,
            letterSpacing: -1.5,
            lineHeight: 1.08,
          }}
        >
          Hiring in India
          <br />
          is broken.
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
