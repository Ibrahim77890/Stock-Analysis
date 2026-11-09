import type { PredictionItem } from "../api/client";
import { episode as copy } from "../copy/episode";
import { EmptyState } from "../components/ui";

export const statusWord = (s: string): string => (s === "pending" ? copy.waiting : s === "resolved" ? copy.answered : copy.notCounted);

/** right = said more than 50% and it went up, or less than 50% and it did not. At exactly 50% there is no verdict. */
export function verdict(p: PredictionItem): "right" | "off" | "none" {
  if (p.status !== "resolved" || p.outcome === null || p.p_up === 0.5) return "none";
  return (p.p_up > 0.5) === (p.outcome === 1) ? "right" : "off";
}

export function GuessList({ items }: { items: PredictionItem[] }) {
  if (items.length === 0) return <EmptyState>{copy.noGuesses}</EmptyState>;
  return (
    <table aria-label={copy.guessesTitle}>
      <thead><tr><th>Made on day</th><th>How far ahead</th><th>You said</th><th>Status</th><th>What happened</th></tr></thead>
      <tbody>
        {items.map((p) => {
          const v = verdict(p);
          return (
            <tr key={p.prediction_id}>
              <td>{p.day}</td>
              <td>{copy.horizons[String(p.horizon) as "1" | "5" | "10"]}</td>
              <td>{Math.round(p.p_up * 100)}%</td>
              <td>{statusWord(p.status)}</td>
              <td>
                {p.status === "resolved" && (
                  <>
                    <span className={p.outcome === 1 ? "up" : "down"}>{p.outcome === 1 ? "▲ " + copy.wentUp : "▼ " + copy.didNotGoUp}</span>
                    {v !== "none" && <span>. {v === "right" ? copy.right : copy.off}</span>}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
