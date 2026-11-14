import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

const EASE = [0.22, 1, 0.36, 1] as const;

// One requirement woven between the four parties, echoing the nest in the logo.
// The outer loop is the requirement's path between parties; the inner strands
// tie each party back to the single shared requirement in the centre.
const LOOP = 'M 64 200 C 72 118, 132 66, 200 60 C 268 66, 328 118, 336 200 C 328 282, 268 334, 200 340 C 132 334, 72 282, 64 200 Z';

const STRANDS = [
  'M 200 60 C 170 110, 230 150, 200 200',
  'M 336 200 C 290 172, 250 228, 200 200',
  'M 200 340 C 230 290, 170 250, 200 200',
  'M 64 200 C 110 228, 150 172, 200 200',
];

// Labels sit outside the loop so they never cross a strand; the viewBox is widened to hold the side labels.
const PARTIES: { label: string; x: number; y: number; textAnchor: 'start' | 'middle' | 'end'; dx: number; dy: number }[] = [
  { label: 'HireNest HQ', x: 200, y: 60, textAnchor: 'middle', dx: 0, dy: -22 },
  { label: 'Staffing vendor', x: 336, y: 200, textAnchor: 'start', dx: 20, dy: 5 },
  { label: 'Candidate', x: 200, y: 340, textAnchor: 'middle', dx: 0, dy: 34 },
  { label: 'Hiring client', x: 64, y: 200, textAnchor: 'end', dx: -20, dy: 5 },
];

export const RequirementThread: React.FC<{ className?: string }> = ({ className = '' }) => {
  const reduce = useReducedMotion();
  const draw = (delay: number, duration = 1.4) =>
    reduce
      ? { initial: false as const }
      : {
          initial: { pathLength: 0, opacity: 0 },
          animate: { pathLength: 1, opacity: 1 },
          transition: { pathLength: { duration, delay, ease: EASE }, opacity: { duration: 0.2, delay } },
        };

  return (
    <svg
      viewBox="-110 10 620 380"
      className={className}
      role="img"
      aria-label="A requirement shared between HireNest HQ, hiring clients, staffing vendors and candidates"
    >
      {/* Faint second weave behind the loop, like the nest's layered strands */}
      <motion.path
        d="M 82 214 C 92 128, 146 84, 208 78 C 274 88, 320 140, 318 214 C 306 290, 250 326, 190 322 C 128 314, 86 270, 82 214 Z"
        fill="none"
        stroke="rgba(185, 209, 251, 0.16)"
        strokeWidth={1}
        {...draw(0.1, 1.8)}
      />

      <motion.path d={LOOP} fill="none" stroke="#38ACEF" strokeWidth={1.5} strokeLinecap="round" {...draw(0.2)} />

      {STRANDS.map((d, i) => (
        <motion.path
          key={d}
          d={d}
          fill="none"
          stroke="rgba(185, 209, 251, 0.45)"
          strokeWidth={1.25}
          strokeLinecap="round"
          {...draw(0.9 + i * 0.12, 0.9)}
        />
      ))}

      {/* A single pulse keeps moving along the loop once it is drawn */}
      {!reduce && (
        <motion.circle
          r={4}
          fill="#FFFEFB"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.8, duration: 0.4 }}
          style={{ offsetPath: `path('${LOOP}')`, offsetRotate: '0deg' } as React.CSSProperties}
          className="thread-pulse"
        />
      )}

      {PARTIES.map((p, i) => (
        <motion.g
          key={p.label}
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 + i * 0.15, duration: 0.5, ease: EASE }}
          style={{ transformOrigin: `${p.x}px ${p.y}px`, transformBox: 'view-box' } as React.CSSProperties}
        >
          <circle cx={p.x} cy={p.y} r={9} fill="#14213D" stroke="#38ACEF" strokeWidth={2} />
          <text
            x={p.x + p.dx}
            y={p.y + p.dy}
            textAnchor={p.textAnchor}
            fill="#DCE8FD"
            fontSize={18}
            fontWeight={500}
            fontFamily="Inter, system-ui, sans-serif"
          >
            {p.label}
          </text>
        </motion.g>
      ))}

      <motion.g
        initial={reduce ? false : { opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.3, duration: 0.6, ease: EASE }}
        style={{ transformOrigin: '200px 200px', transformBox: 'view-box' } as React.CSSProperties}
      >
        <circle cx={200} cy={200} r={48} fill="#1D5FD1" />
        <circle cx={200} cy={200} r={56} fill="none" stroke="rgba(56, 172, 239, 0.35)" strokeWidth={1} />
        <text x={200} y={204} textAnchor="middle" fill="#FFFEFB" fontSize={13} fontWeight={600} fontFamily="Inter, system-ui, sans-serif">
          Requirement
        </text>
      </motion.g>
    </svg>
  );
};
