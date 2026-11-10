import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EpisodeListItem, Journal } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Card, Chip, EmptyState, ErrorMessage, Loading, PageHead } from "../components/ui";
import { journal as copy } from "../copy/journal";

export const resultWords = (r: number | null | undefined): string => {
  if (r === null || r === undefined) return copy.waiting;
  const pct = `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
  return copy.result(pct);
};

/** How many decisions say how much: never a rate without the count. */
export const countLine = (n: number): string => (n >= 30 ? copy.manyCount(n) : copy.count(n));

interface Entry { episode: EpisodeListItem; index: number; journal: Journal }

export function JournalPage() {
  const { api } = useAuth();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const eps = await api.listEpisodes();
      const recent = eps.slice(0, 20);
      const journals = await Promise.all(recent.map((e) => api.journal(e.episode_id)));
      const out: Entry[] = [];
      recent.forEach((episode, i) => { if (journals[i].decisions.length > 0) out.push({ episode, index: eps.length - i, journal: journals[i] }); });
      if (alive) setEntries(out);
    })().catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [api]);

  if (error) return <ErrorMessage>{error}</ErrorMessage>;
  if (!entries) return <Loading>{copy.loading}</Loading>;
  return (
    <>
      <PageHead title={copy.title} intro={copy.intro} eyebrow={<><Icon name="book" />Practice</>} />
      {entries.length === 0 && <EmptyState>{copy.none}</EmptyState>}
      {entries.map(({ episode, index, journal }) => {
        const revealed = episode.status === "revealed";
        const total = journal.totals.decisions;
        return (
          <Card key={episode.episode_id}>
            <div className="card-head">
              <div>
                <p className="eyebrow">{copy.dayOf(journal.day, episode.n_bars)}</p>
                <h2>{copy.episode(index)}</h2>
              </div>
              <Chip kind={revealed ? "ok" : "accent"}>{revealed ? copy.revealed : copy.open}</Chip>
            </div>
            <div className="table-wrap">
              <table aria-label={`${copy.episode(index)}: ${copy.title}`}>
                <thead><tr><th>{copy.colDay}</th><th>{copy.colStance}</th><th>{copy.colReason}</th><th>{copy.colResult}</th></tr></thead>
                <tbody>
                  {journal.decisions.map((d) => (
                    <tr key={d.decision_id}>
                      <td>{d.day}</td><td>{copy.stance[d.stance] ?? d.stance}</td><td>{d.reason}</td><td>{resultWords(d.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">{countLine(total)}</p>
            {revealed && (
              <>
                <h3>{copy.reviewTitle}</h3>
                <p className="muted small">{copy.reviewIntro}</p>
                <ul>{copy.prompts.map((p) => <li key={p}>{p}</li>)}</ul>
              </>
            )}
            <Link className="btn secondary small" to={`/learn/${episode.episode_id}`}>{copy.openEpisode}<Icon name="arrow" /></Link>
          </Card>
        );
      })}
    </>
  );
}
