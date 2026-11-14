import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { palette } from "../theme";

export const Backdrop: React.FC<{ tint?: string }> = ({ tint = palette.brand }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 300], [0, 40], {
    extrapolateRight: "extend",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 800px at 18% -10%, ${tint}22, transparent 60%),
                     radial-gradient(1000px 700px at 100% 110%, ${palette.teal}14, transparent 55%),
                     linear-gradient(180deg, ${palette.navyDeep} 0%, ${palette.navy} 100%)`,
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          transform: `translateY(${drift * 0.3}px)`,
          opacity: 0.5,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 640,
          height: 640,
          borderRadius: "50%",
          right: -160,
          top: -160 + drift,
          background: `radial-gradient(circle, ${tint}2e 0%, ${tint}00 70%)`,
        }}
      />
    </AbsoluteFill>
  );
};
