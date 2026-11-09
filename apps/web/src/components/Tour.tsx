import { useState } from "react";
import { tour } from "../copy/home";
import { Icon } from "./Icon";
import { Rich } from "./Term";
import { Button, ProgressBar } from "./ui";

export const TOUR_KEY = "marketlab.tour.seen";

export function tourSeen(): boolean {
  try { return sessionStorage.getItem(TOUR_KEY) === "1"; } catch { return false; }
}

/** Short, skippable, reopenable guided tour (inline, not a pop-up window). */
export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = i === tour.steps.length - 1;
  const close = () => { try { sessionStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ } onClose(); };
  const step = tour.steps[i];
  return (
    <section className="card accent" aria-label={tour.title}>
      <div className="card-head">
        <h2><Icon name="idea" /> {tour.title} <span className="muted">({i + 1} of {tour.steps.length})</span></h2>
      </div>
      <ProgressBar value={i + 1} max={tour.steps.length} label="Tour progress" />
      <h3 style={{ marginTop: "1rem" }}>{step.head}</h3>
      <p><Rich text={step.body} /></p>
      <div className="row">
        {i > 0 && <Button variant="secondary" onClick={() => setI(i - 1)}>{tour.back}</Button>}
        {!last && <Button onClick={() => setI(i + 1)}>{tour.next}</Button>}
        {last && <Button onClick={close}>{tour.done}</Button>}
        {!last && <Button variant="ghost" onClick={close}>{tour.skip}</Button>}
      </div>
    </section>
  );
}
