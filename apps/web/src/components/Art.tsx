/** Decorative illustrations (inline SVG, drawn with design tokens). They carry no information, so they are hidden from screen readers. */
const candle = (x: number, top: number, h: number, wick1: number, wick2: number, up: boolean) => (
  <g key={x}>
    <line x1={x + 10} x2={x + 10} y1={top - wick1} y2={top + h + wick2} style={{ stroke: up ? "var(--up)" : "var(--down)" }} strokeWidth="3" strokeLinecap="round" />
    <rect x={x} y={top} width="20" height={h} rx="4" style={{ fill: up ? "var(--up)" : "var(--down)" }} />
  </g>
);

export function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 400 300" aria-hidden="true" focusable="false">
      <rect x="10" y="10" width="380" height="280" rx="22" style={{ fill: "var(--surface)", stroke: "var(--line)" }} strokeWidth="2" />
      <g style={{ stroke: "var(--line)" }} strokeWidth="1.5">
        <line x1="30" x2="370" y1="80" y2="80" /><line x1="30" x2="370" y2="140" y1="140" /><line x1="30" x2="370" y1="200" y2="200" /><line x1="30" x2="370" y1="250" y2="250" />
      </g>
      {candle(40, 150, 40, 14, 12, true)}
      {candle(72, 130, 50, 12, 10, true)}
      {candle(104, 118, 36, 14, 16, false)}
      {candle(136, 124, 54, 10, 14, true)}
      {candle(168, 96, 52, 16, 12, true)}
      {candle(200, 100, 30, 12, 18, false)}
      <rect x="236" y="40" width="132" height="226" rx="14" style={{ fill: "var(--accent-soft)", stroke: "var(--accent)" }} strokeWidth="2" strokeDasharray="7 6" />
      <text x="302" y="172" textAnchor="middle" fontSize="64" fontWeight="800" style={{ fill: "var(--accent)" }}>?</text>
      <text x="302" y="206" textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: "var(--accent-strong)" }}>what happens next</text>
      <g transform="translate(40 52)">
        <rect width="172" height="30" rx="15" style={{ fill: "var(--teal-soft)" }} />
        <text x="86" y="20" textAnchor="middle" fontSize="13" fontWeight="700" style={{ fill: "var(--teal)" }}>name and dates hidden</text>
      </g>
    </svg>
  );
}

export function LabArt() {
  return (
    <svg className="hero-art" viewBox="0 0 400 300" aria-hidden="true" focusable="false">
      <rect x="10" y="10" width="380" height="280" rx="22" style={{ fill: "var(--surface)", stroke: "var(--line)" }} strokeWidth="2" />
      <polyline points="34,230 80,200 120,214 170,150 214,170 262,110" fill="none" style={{ stroke: "var(--series-rule)" }} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="34,220 80,212 120,196 170,184 214,160 262,150" fill="none" style={{ stroke: "var(--series-hold)" }} strokeWidth="4" strokeDasharray="9 7" strokeLinecap="round" />
      <rect x="282" y="60" width="92" height="200" rx="14" style={{ fill: "var(--accent-soft)", stroke: "var(--accent)" }} strokeWidth="2" />
      <rect x="310" y="118" width="36" height="30" rx="6" style={{ fill: "var(--accent)" }} />
      <path d="M316 118v-10a12 12 0 0 1 24 0v10" fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="5" strokeLinecap="round" />
      <text x="328" y="186" textAnchor="middle" fontSize="15" fontWeight="800" style={{ fill: "var(--accent-strong)" }}>vault</text>
      <text x="40" y="52" fontSize="14" fontWeight="700" style={{ fill: "var(--muted)" }}>rule vs just holding</text>
    </svg>
  );
}
