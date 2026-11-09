import { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button type="button" {...rest} className={`btn ${variant === "secondary" ? "secondary" : ""} ${rest.className ?? ""}`} />;
}

export function Card({ title, children, label }: { title?: string; children: ReactNode; label?: string }) {
  return (
    <section className="card" aria-label={label ?? title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

const LABELS = { info: "Good to know", tip: "Tip", careful: "Careful" } as const;
const ICONS = { info: "i", tip: "+", careful: "!" } as const;

/** Always shows its label word, so colour is never the only signal. */
export function Callout({ kind = "info", children }: { kind?: keyof typeof LABELS; children: ReactNode }) {
  return (
    <div className={`callout ${kind}`} role={kind === "careful" ? "note" : undefined}>
      <strong className="label"><span aria-hidden="true">{ICONS[kind]} </span>{LABELS[kind]}</strong>
      {children}
    </div>
  );
}

export function Stat({ big, meaning }: { big: ReactNode; meaning: ReactNode }) {
  return (
    <div className="stat">
      <div className="big">{big}</div>
      <div className="meaning">{meaning}</div>
    </div>
  );
}

export function Stepper({ steps, current }: { steps: Array<{ step: string; hint: string }>; current: number }) {
  return (
    <div>
      <ol className="steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.step} aria-current={i === current ? "step" : undefined}>{s.step}</li>
        ))}
      </ol>
      <p className="muted" aria-live="polite">{steps[current].hint}</p>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted" role="status">{children}</p>;
}

export function Loading({ children = "Loading..." }: { children?: ReactNode }) {
  return <p className="muted" role="status">{children}</p>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <Callout kind="careful"><span role="alert">{children}</span></Callout>;
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "-" : `${(x * 100).toFixed(digits)}%`);
export const num = (x: number | null | undefined, digits = 3) => (x === null || x === undefined ? "-" : x.toFixed(digits));
