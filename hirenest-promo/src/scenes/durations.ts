export const SCENES = {
  problem: 361,
  logo: 184,
  flow: 267,
  vendor: 270,
  hq: 261,
  candidate: 160,
  compliance: 195,
  cta: 171,
} as const;

export const TRANSITION_FRAMES = 15;

export const TOTAL_FRAMES =
  Object.values(SCENES).reduce((sum, d) => sum + d, 0) -
  (Object.keys(SCENES).length - 1) * TRANSITION_FRAMES;
