import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadManrope } from "@remotion/google-fonts/Manrope";

export const inter = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
});

export const manrope = loadManrope("normal", {
  weights: ["700", "800"],
  subsets: ["latin"],
});

export const palette = {
  navy: "#0A1026",
  navyDeep: "#060A18",
  panel: "#10193A",
  panelBorder: "rgba(255,255,255,0.08)",
  ink: "#F4F7FF",
  inkSoft: "rgba(244,247,255,0.72)",
  inkFaint: "rgba(244,247,255,0.46)",
  brand: "#3D63FF",
  brandDeep: "#2947D4",
  brandSoft: "rgba(61,99,255,0.16)",
  teal: "#2FD6B5",
  sky: "#4FC3F7",
  amber: "#F5B942",
  rose: "#FF6B6B",
} as const;

export const FPS = 30;
