import { Joyride, STATUS } from "react-joyride";
import type { EventData, Step } from "react-joyride";
import { useMemo } from "react";
import { tour } from "../copy/home";
import { CHART } from "../lib/chartTheme";
import { Rich } from "./Term";

export const TOUR_KEY = "marketlab.tour.seen";

export function tourSeen(): boolean {
  try { return sessionStorage.getItem(TOUR_KEY) === "1"; } catch { return false; }
}

export function markTourSeen(): void {
  try { sessionStorage.setItem(TOUR_KEY, "1"); } catch { /* ignore */ }
}

/** The tour's steps, built from the screen copy. Each step points at an element marked `data-tour="..."`. */
export function tourSteps(): Step[] {
  return tour.steps.map((s) => ({
    id: s.id,
    target: s.target,
    title: s.head,
    content: <Rich text={s.body} />,
    placement: s.placement,
    skipBeacon: true,
  }));
}

/**
 * The quick tour (react-joyride). It runs when `run` is true: the first time someone signs in, and whenever the Tutorial button
 * in the header is pressed. Skipping or finishing calls `onClose`, which also remembers that the tour was seen.
 */
export function Tour({ run, onClose }: { run: boolean; onClose: () => void }) {
  const steps = useMemo(() => tourSteps(), []);
  const onEvent = (data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) onClose();
  };
  return (
    <Joyride
      run={run}
      steps={steps}
      continuous
      onEvent={onEvent}
      locale={{ back: tour.back, next: tour.next, last: tour.done, skip: tour.skip, close: tour.close }}
      options={{
        buttons: ["back", "skip", "primary"],
        showProgress: false,
        primaryColor: CHART.rule,
        textColor: CHART.text,
        backgroundColor: CHART.surface,
        overlayColor: "rgba(23, 32, 51, 0.55)",
        zIndex: 1200,
        spotlightRadius: 10,
        scrollOffset: 90,
      }}
      styles={{ tooltip: { fontFamily: CHART.font, borderRadius: 14 }, tooltipTitle: { fontFamily: CHART.fontHead, fontWeight: 700 } }}
    />
  );
}
