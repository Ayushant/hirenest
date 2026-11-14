import React, { useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react';
import {
  ArrowRight,
  Building2,
  Check,
  FileCheck2,
  Handshake,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserSearch,
} from 'lucide-react';

const EASE = [0.22, 1, 0.36, 1] as const;

// The requirement workflow rendered as a Zapier-style step editor: the same four
// handoffs the product enforces, each one lighting up in sequence and looping.
const STEPS: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  kind: string;
  title: string;
  detail: string;
  meta: string;
}[] = [
  { icon: Building2, kind: 'Trigger', title: 'Client publishes requirement', detail: 'Senior React Engineer · Bengaluru', meta: 'SLA clock started' },
  { icon: ScanSearch, kind: 'HQ', title: 'Deterministic match & route', detail: 'skills · experience · domain · seniority', meta: '3 vendors eligible' },
  { icon: Handshake, kind: 'Vendor', title: 'Candidate submitted', detail: 'Resume de-duplicated (SHA-256)', meta: 'Match 92%' },
  { icon: UserSearch, kind: 'Client', title: 'Interview & structured feedback', detail: 'Shared 6-axis rubric', meta: '< 24h review' },
  { icon: FileCheck2, kind: 'Close', title: 'Offer recorded to audit trail', detail: 'Vendor share logged on the thread', meta: 'Audited' },
];

const MARQUEE = [
  'Deterministic matching',
  'SLA timers on every handoff',
  'SHA-256 resume de-duplication',
  'DPDP Act 2023',
  'Row-level security',
  'Vendor scorecards',
  'Structured interview feedback',
  'Full audit trail',
  'Tenant isolation',
  'AI copilot for JDs',
];

const HEADLINE_LEAD = ['Four', 'roles,', 'one', 'requirement,'];
const HEADLINE_ACCENT = ['zero', 'forwarded', 'emails.'];

function WorkflowCanvas() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(reduce ? STEPS.length : 0);

  useEffect(() => {
    if (reduce) return;
    // Advance one step at a time; hold on the completed state, then replay.
    const id = window.setInterval(() => {
      setActive((a) => (a >= STEPS.length + 1 ? 0 : a + 1));
    }, 1500);
    return () => window.clearInterval(id);
  }, [reduce]);

  const done = Math.min(active, STEPS.length);
  const progress = STEPS.length > 1 ? Math.min(done, STEPS.length - 1) / (STEPS.length - 1) : 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 32, rotateX: 8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.9, delay: 0.35, ease: EASE }}
      style={{ transformPerspective: 1200 }}
      className="relative"
    >
      {/* Floating proof chips */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0, y: reduce ? 0 : [0, -8, 0] }}
        transition={{ opacity: { delay: 1.1, duration: 0.5 }, x: { delay: 1.1, duration: 0.5 }, y: { duration: 5, repeat: Infinity, ease: 'easeInOut' } }}
        className="hidden sm:flex absolute -left-8 -top-5 z-20 items-center gap-2 rounded-[12px] border border-[#14213D] bg-[#FFFEFB] px-3 py-2 shadow-[4px_4px_0_0_#14213D]"
      >
        <ShieldCheck className="h-4 w-4 text-[#1D5FD1]" />
        <span className="text-[12px] font-semibold text-[#14213D]">DPDP 2023 ready</span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0, y: reduce ? 0 : [0, 10, 0] }}
        transition={{ opacity: { delay: 1.3, duration: 0.5 }, x: { delay: 1.3, duration: 0.5 }, y: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
        className="hidden sm:flex absolute -right-6 -bottom-5 z-20 items-center gap-2 rounded-[12px] bg-[#14213D] px-3 py-2 text-[#FFFEFB] shadow-[0_18px_40px_-12px_rgba(20, 33, 61,0.45)]"
      >
        <Sparkles className="h-4 w-4 text-[#4F8EEE]" />
        <span className="text-[12px] font-semibold">Ranked shortlist in 48h</span>
      </motion.div>

      <div className="relative rounded-[16px] border border-[#14213D] bg-[#FFFEFB] shadow-[0_30px_80px_-30px_rgba(20, 33, 61,0.35)] overflow-hidden">
        {/* Editor chrome */}
        <div className="flex items-center justify-between border-b border-[#E6E0D6] bg-[#F8F4F0] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#E3DDD3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#E3DDD3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#E3DDD3]" />
          </div>
          <span className="font-mono text-[11px] text-[#716E64]">requirement_7f21</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E6EFFE] px-2 py-0.5 text-[11px] font-semibold text-[#1A56C2]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#1D5FD1] opacity-75 animate-ping" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#1D5FD1]" />
            </span>
            Live
          </span>
        </div>

        <div className="relative px-4 sm:px-6 py-5">
          {/* Connector rail and its animated fill */}
          <div className="absolute left-[46px] sm:left-[54px] top-[50px] bottom-[50px] w-[2px] bg-[#EFE9E1]" />
          <motion.div
            className="absolute left-[46px] sm:left-[54px] top-[50px] bottom-[50px] w-[2px] origin-top bg-[#1D5FD1]"
            animate={{ scaleY: progress }}
            transition={{ duration: 0.6, ease: EASE }}
          />

          <ol className="relative space-y-3">
            {STEPS.map((step, i) => {
              const Icon = step.icon;
              const isDone = i < done;
              const isActive = i === active && active < STEPS.length;
              return (
                <motion.li
                  key={step.title}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.6 + i * 0.09, ease: EASE }}
                  className={`relative flex items-center gap-3 rounded-[12px] border px-3 py-2.5 transition-colors duration-300 ${
                    isActive
                      ? 'border-[#1D5FD1] bg-[#F4F8FF] shadow-[0_8px_24px_-12px_rgba(29, 95, 209,0.6)]'
                      : 'border-[#E6E0D6] bg-[#FFFEFB]'
                  }`}
                >
                  <div className="relative shrink-0">
                    {isActive && !reduce && (
                      <span className="absolute inset-0 rounded-[10px] bg-[#1D5FD1]/30 hero-pulse-ring" />
                    )}
                    <div
                      className={`relative h-9 w-9 rounded-[10px] flex items-center justify-center transition-colors duration-300 ${
                        isDone ? 'bg-[#1D5FD1] text-[#FFFEFB]' : isActive ? 'bg-[#14213D] text-[#FFFEFB]' : 'bg-[#F0EBE4] text-[#605D52]'
                      }`}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        {isDone ? (
                          <motion.span key="done" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                            <Check className="h-4 w-4" strokeWidth={3} />
                          </motion.span>
                        ) : (
                          <motion.span key="icon" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                            <Icon className="h-4 w-4" strokeWidth={2} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#716E64]">
                        {i + 1}. {step.kind}
                      </span>
                    </div>
                    <div className="text-[13.5px] font-semibold text-[#14213D] truncate">{step.title}</div>
                    <div className="text-[12px] text-[#716E64] truncate">{step.detail}</div>
                  </div>

                  <AnimatePresence>
                    {(isDone || isActive) && (
                      <motion.span
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`hidden sm:inline-flex shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-medium ${
                          isDone ? 'bg-[#F0EBE4] text-[#36342E]' : 'bg-[#1D5FD1] text-[#FFFEFB]'
                        }`}
                      >
                        {step.meta}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ol>
        </div>

        <div className="flex items-center justify-between border-t border-[#E6E0D6] bg-[#F8F4F0] px-4 py-2.5 font-mono text-[11px] text-[#716E64]">
          <span>
            {done}/{STEPS.length} handoffs complete
          </span>
          <span className="hidden sm:inline">Audit trail · every step logged</span>
        </div>
      </div>
    </motion.div>
  );
}

export function HeroSection() {
  const reduce = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);

  // Soft blue spotlight that trails the cursor across the hero.
  const mx = useMotionValue(70);
  const my = useMotionValue(30);
  const sx = useSpring(mx, { stiffness: 80, damping: 20 });
  const sy = useSpring(my, { stiffness: 80, damping: 20 });
  const spotlight = useMotionTemplate`radial-gradient(600px circle at ${sx}% ${sy}%, rgba(29, 95, 209,0.13), transparent 60%)`;

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    if (reduce || !sectionRef.current) return;
    const r = sectionRef.current.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 100);
    my.set(((e.clientY - r.top) / r.height) * 100);
  };

  const word = {
    hidden: { opacity: 0, y: '0.6em', filter: 'blur(8px)' },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.7, delay: 0.1 + i * 0.07, ease: EASE },
    }),
  };

  return (
    <section
      ref={sectionRef}
      onMouseMove={onMove}
      className="relative overflow-hidden bg-[#FFFEFB] pt-14 sm:pt-20 pb-0"
    >
      {/* Atmosphere: masked grid, cursor spotlight, slow drifting glow */}
      <div className="pointer-events-none absolute inset-0 hero-grid-bg" />
      <motion.div className="pointer-events-none absolute inset-0" style={{ background: spotlight }} />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-[#1D5FD1]/10 blur-3xl"
        animate={reduce ? undefined : { x: [0, -60, 0], y: [0, 40, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-16 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="inline-flex items-center gap-2 rounded-full border border-[#E6E0D6] bg-[#F8F4F0] pl-1.5 pr-3 py-1 mb-7"
          >
            <span className="rounded-full bg-[#1D5FD1] px-2 py-0.5 text-[11px] font-semibold text-[#FFFEFB]">New</span>
            <span className="type-eyebrow !text-[11px] !tracking-[0.06em] text-[#36342E]">
              Enterprise recruitment orchestration
            </span>
          </motion.div>

          <h1 className="type-display-xl text-[#14213D] max-w-[12ch] sm:max-w-[14ch]">
            {HEADLINE_LEAD.map((w, i) => (
              <motion.span key={w + i} custom={i} variants={word} initial="hidden" animate="show" className="inline-block mr-[0.22em]">
                {w}
              </motion.span>
            ))}
            {HEADLINE_ACCENT.map((w, i) => {
              const isLast = i === HEADLINE_ACCENT.length - 1;
              return (
                <motion.span
                  key={w}
                  custom={HEADLINE_LEAD.length + i}
                  variants={word}
                  initial="hidden"
                  animate="show"
                  className={`relative inline-block text-[#1D5FD1] ${isLast ? '' : 'mr-[0.22em]'}`}
                >
                  {w}
                  {isLast && (
                    // Hand-drawn underline that draws itself in after the headline lands
                    <svg aria-hidden viewBox="0 0 300 16" preserveAspectRatio="none" className="absolute left-0 -bottom-[0.08em] h-[0.2em] w-full overflow-visible">
                      <motion.path
                        d="M2 11 C 60 3, 130 3, 180 8 S 270 14, 298 5"
                        fill="none"
                        stroke="#14213D"
                        strokeWidth="5"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.9, delay: 1.05, ease: EASE }}
                      />
                    </svg>
                  )}
                </motion.span>
              );
            })}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.75, ease: EASE }}
            className="text-[18px] sm:text-[20px] leading-[1.5] tracking-[-0.01em] text-[#605D52] mt-7 max-w-xl"
          >
            HireNestOS routes a requirement between hiring clients, staffing vendors, candidates and
            HireNest HQ with deterministic skill matching, SLA timers and a full audit trail, not a chain
            of CC'd emails.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.9, ease: EASE }}
            className="flex flex-wrap items-center gap-3 mt-9"
          >
            <a href="#early-access" className="zp-btn zp-btn-primary group">
              Request early access
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </a>
            <a href="#platform" className="zp-btn zp-btn-tertiary">
              See how it's structured
            </a>
          </motion.div>

          <motion.dl
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1, delayChildren: 1.1 } } }}
            className="grid grid-cols-3 gap-4 mt-12 pt-8 border-t border-[#E6E0D6] max-w-lg"
          >
            {[
              ['48h', 'to first shortlist'],
              ['SHA-256', 'resume de-duplication'],
              ['6-axis', 'scoring rubric'],
            ].map(([value, label]) => (
              <motion.div
                key={label}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } }}
              >
                <dt className="font-display text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em] text-[#14213D]">{value}</dt>
                <dd className="text-[13px] text-[#716E64] mt-0.5">{label}</dd>
              </motion.div>
            ))}
          </motion.dl>
        </div>

        <div className="lg:pl-6">
          <WorkflowCanvas />
        </div>
      </div>

      {/* Capability marquee */}
      <div className="relative mt-16 sm:mt-20 border-y border-[#14213D] bg-[#14213D] py-4 marquee-mask overflow-hidden">
        <div className={`flex w-max gap-10 ${reduce ? '' : 'animate-marquee'}`}>
          {[...MARQUEE, ...MARQUEE].map((item, i) => (
            <span key={i} className="flex items-center gap-10 text-[15px] font-medium text-[#F8F4F0] whitespace-nowrap">
              {item}
              <span className="h-1.5 w-1.5 rounded-full bg-[#1D5FD1]" aria-hidden />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
