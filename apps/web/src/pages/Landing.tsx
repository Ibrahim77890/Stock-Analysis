import { ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Icon, IconName } from "../components/Icon";
import { landing as copy } from "../copy/landing";

/** True when the visitor asked their system for less motion. */
const reducedMotion = (): boolean => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Adds the class "in" when the element scrolls into view (the CSS fades and lifts it). Without IntersectionObserver it is shown at once. */
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined" || reducedMotion());
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return <div ref={ref} className={`reveal ${seen ? "in" : ""} ${className}`.trim()} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

/** Counts up from 0 to `to` once, when it scrolls into view. The final number is always in the page text. */
export function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const finished = useRef(typeof IntersectionObserver === "undefined" || reducedMotion());
  const [n, setN] = useState(() => (finished.current ? to : 0));
  useEffect(() => {
    if (finished.current || !ref.current) return;
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / 1100);
        setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(tick); else finished.current = true;
      };
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(ref.current);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <><span className="sr-only">{to}</span><span ref={ref} aria-hidden="true">{n}</span></>;
}

/** Decorative animated chart: candles rise one after another, then the hidden box pulses. Hidden from screen readers. */
export function AnimatedHeroArt() {
  const candles: Array<[number, number, number, boolean]> = [[44, 150, 40, true], [78, 130, 50, true], [112, 120, 36, false], [146, 126, 54, true], [180, 98, 52, true], [214, 102, 30, false]];
  return (
    <svg className="hero-art animated-art" viewBox="0 0 420 300" role="img" aria-label={copy.artLabel} focusable="false">
      <rect x="10" y="10" width="400" height="280" rx="22" style={{ fill: "var(--surface)", stroke: "var(--line)" }} strokeWidth="2" />
      <g style={{ stroke: "var(--line)" }} strokeWidth="1.5">
        <line x1="30" x2="390" y1="80" y2="80" /><line x1="30" x2="390" y1="140" y2="140" /><line x1="30" x2="390" y1="200" y2="200" /><line x1="30" x2="390" y1="250" y2="250" />
      </g>
      {candles.map(([x, top, h, up], i) => (
        <g key={x} className="art-candle" style={{ animationDelay: `${300 + i * 220}ms`, transformOrigin: `${x + 10}px 260px` }}>
          <line x1={x + 10} x2={x + 10} y1={top - 14} y2={top + h + 12} style={{ stroke: up ? "var(--up)" : "var(--down)" }} strokeWidth="3" strokeLinecap="round" />
          <rect x={x} y={top} width="20" height={h} rx="4" style={{ fill: up ? "var(--up)" : "var(--down)" }} />
        </g>
      ))}
      <polyline className="art-line" points="54,176 88,152 122,142 156,150 190,120 224,128" fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g className="art-hidden">
        <rect x="256" y="40" width="136" height="226" rx="14" style={{ fill: "var(--accent-soft)", stroke: "var(--accent)" }} strokeWidth="2" strokeDasharray="7 6" />
        <text x="324" y="172" textAnchor="middle" fontSize="64" fontWeight="800" style={{ fill: "var(--accent)" }}>?</text>
        <text x="324" y="206" textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: "var(--accent-strong)" }}>what happens next</text>
      </g>
      <g className="art-chip" transform="translate(44 50)">
        <rect width="172" height="30" rx="15" style={{ fill: "var(--teal-soft)" }} />
        <text x="86" y="20" textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: "var(--teal)" }}>name and dates hidden</text>
      </g>
    </svg>
  );
}

export function Landing() {
  const { learner } = useAuth();
  if (learner) return <Navigate to="/" replace />;   // signed in: the home page is "/"
  return (
    <div className="landing">
      <section className="hero landing-hero">
        <div>
          <span className="eyebrow"><Icon name="shield" />{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p className="lead">{copy.intro}</p>
          <div className="row">
            <Link className="btn big pulse" to="/sign-in?mode=register">{copy.create}<Icon name="arrow" /></Link>
            <Link className="btn big secondary" to="/sign-in">{copy.signIn}</Link>
          </div>
          <p className="muted small">{copy.localNote}</p>
        </div>
        <AnimatedHeroArt />
      </section>

      <section aria-label={copy.statsLabel} className="stats-strip">
        {copy.stats.map((s) => (
          <Reveal key={s.label} className="stat-box">
            <strong className="stat-num"><CountUp to={s.value} /></strong>
            <span>{s.label}</span>
          </Reveal>
        ))}
      </section>

      <section>
        <Reveal><h2 className="section-title">{copy.featuresTitle}</h2><p className="muted section-intro">{copy.featuresIntro}</p></Reveal>
        <div className="feature-grid">
          {copy.features.map((f, i) => (
            <Reveal key={f.head} delay={(i % 4) * 90} className="feature-card-wrap">
              <article className="feature-card">
                <span className="badge"><Icon name={f.icon as IconName} /></span>
                <h3>{f.head}</h3>
                <p>{f.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section>
        <Reveal><h2 className="section-title">{copy.howTitle}</h2></Reveal>
        <ol className="how-steps">
          {copy.how.map((s, i) => (
            <li key={s.head}>
              <Reveal delay={i * 120}>
                <div className="how-step"><span className="how-n">{i + 1}</span><div><h3>{s.head}</h3><p>{s.body}</p></div></div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <Reveal>
          <div className="principles">
            <h2>{copy.principlesTitle}</h2>
            <ul className="how-list">
              {copy.principles.map((p) => <li key={p}><Icon name="warn" /><span>{p}</span></li>)}
            </ul>
          </div>
        </Reveal>
      </section>

      <Reveal>
        <section className="cta-band">
          <h2>{copy.ctaTitle}</h2>
          <p>{copy.ctaBody}</p>
          <div className="row">
            <Link className="btn big pulse" to="/sign-in?mode=register">{copy.create}<Icon name="arrow" /></Link>
            <Link className="btn big secondary" to="/sign-in">{copy.signIn}</Link>
          </div>
          <p className="small">{copy.careful}</p>
        </section>
      </Reveal>
    </div>
  );
}
