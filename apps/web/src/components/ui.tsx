import { ComponentProps, ReactNode } from "react";
import { Icon, IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost";

export function Button({ variant = "primary", size, ...rest }: ComponentProps<"button"> & { variant?: Variant; size?: "small" | "big" }) {
  const cls = ["btn", variant === "primary" ? "" : variant, size ?? "", rest.className ?? ""].filter(Boolean).join(" ");
  return <button type="button" {...rest} className={cls} />;
}

export function Card({ title, children, label, className }: { title?: string; children: ReactNode; label?: string; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`.trim()} aria-label={label ?? title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

/** A page title with an optional one-line explanation and actions on the right. */
export function PageHead({ title, intro, eyebrow, children }: { title: string; intro?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head spread">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}

const LABELS = { info: "Good to know", tip: "Tip", careful: "Careful" } as const;
const ICONS: Record<keyof typeof LABELS, IconName> = { info: "info", tip: "idea", careful: "warn" };

/** Always shows its label word, so colour is never the only signal. */
export function Callout({ kind = "info", children }: { kind?: keyof typeof LABELS; children: ReactNode }) {
  return (
    <div className={`callout ${kind}`} role={kind === "careful" ? "note" : undefined}>
      <Icon name={ICONS[kind]} />
      <div className="body"><strong className="label">{LABELS[kind]}</strong>{children}</div>
    </div>
  );
}

export function Chip({ kind, children }: { kind?: "ok" | "warn" | "accent"; children: ReactNode }) {
  return <span className={`chip ${kind ?? ""}`.trim()}>{children}</span>;
}

/** A big number with a plain-language meaning under it. */
export function Stat({ big, meaning }: { big: ReactNode; meaning: ReactNode }) {
  return (
    <div className="stat">
      <div className="big">{big}</div>
      <div className="meaning">{meaning}</div>
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Stepper({ steps, current }: { steps: Array<{ step: string; hint: string }>; current: number }) {
  return (
    <div>
      <ol className="coach" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.step} aria-current={i === current ? "step" : undefined}>{s.step}</li>
        ))}
      </ol>
      <p className="coach-hint" aria-live="polite"><Icon name="idea" /><span>{steps[current].hint}</span></p>
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pctDone = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pctDone}%` }} />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty" role="status">{children}</p>;
}

export function Loading({ children = "Loading..." }: { children?: ReactNode }) {
  return (
    <div role="status" className="muted">
      <span className="spinner" aria-hidden="true" /> {children}
    </div>
  );
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <Callout kind="careful"><span role="alert">{children}</span></Callout>;
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(digits)}%`);
export const num = (x: number | null | undefined, digits = 3) => (x === null || x === undefined ? "-" : x.toFixed(digits));
