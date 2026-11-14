import { useEffect, useState } from "react";
import type { DataStatus, Health } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Callout, Card, Chip, EmptyState, ErrorMessage, Loading, PageHead } from "../components/ui";
import { status as copy } from "../copy/status";

const fmt = (n: number) => n.toLocaleString("en-US");

export function DataCards({ data }: { data: DataStatus }) {
  const last = data.sources.map((s) => s.last_date).sort().at(-1);
  return (
    <>
      {data.empty && <EmptyState>{copy.empty}</EmptyState>}
      {!data.empty && (
        <>
          <Card title={copy.fromTitle}>
            <div className="table-wrap">
              <table aria-label={copy.table}>
                <caption>{copy.table}</caption>
                <thead><tr><th>{copy.source}</th><th>{copy.symbols}</th><th>{copy.bars}</th><th>{copy.from}</th><th>{copy.to}</th><th>{copy.retrieved}</th></tr></thead>
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.source}>
                      <td>{copy.sourceLine(s.source)}</td><td>{fmt(s.symbols)}</td><td>{fmt(s.bars)}</td>
                      <td>{s.first_date}</td><td>{s.last_date}</td><td>{s.retrieved_at ? s.retrieved_at.slice(0, 10) : copy.unknownDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title={copy.coverTitle}>
            <ul>{data.sources.map((s) => <li key={s.source}><strong>{s.source}</strong>: {copy.longHistory(s.symbols_with_long_history, data.min_sessions_for_long_history)}</li>)}</ul>
            <p className="muted">{copy.macro(data.macro.series, data.macro.observations)}</p>
          </Card>
          {last && <Card title={copy.freshTitle}><p>{copy.freshLine(last)}</p></Card>}
        </>
      )}
      <Card title={copy.checksTitle}>
        {data.quality.run ? (
          <>
            <p>{copy.checksLine(data.quality.rules_flagged, data.quality.warnings, data.quality.errors)}</p>
            <p className="muted">{copy.checksFew}</p>
          </>
        ) : <Callout kind="careful">{copy.checksNone}</Callout>}
      </Card>
      <Card title={copy.cannotTitle}>
        <ul className="how-list">
          {data.caveats.map((c) => <li key={c}><Icon name="warn" /><span>{c}</span></li>)}
        </ul>
      </Card>
    </>
  );
}

export function HealthCard({ health }: { health: Health }) {
  const parts: Array<[string, string]> = [["gateway", health.gateway], ["database", health.database], ["python", health.python]];
  const down = parts.filter(([, v]) => v !== "ok");
  return (
    <Card title={copy.healthTitle}>
      <p>{down.length === 0 ? copy.healthOk : `${copy.healthDown} ${down.map(([k]) => copy.parts[k]).join(", ")}.`}</p>
      <ul className="how-list">
        {parts.map(([k, v]) => (
          <li key={k}><Icon name={v === "ok" ? "check" : "warn"} /><span>{copy.parts[k]}: <Chip kind={v === "ok" ? "ok" : "warn"}>{v === "ok" ? copy.ok : copy.down}</Chip></span></li>
        ))}
      </ul>
    </Card>
  );
}

export function StatusPage() {
  const { api } = useAuth();
  const [data, setData] = useState<DataStatus | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.dataStatus().then((d) => alive && setData(d), (e) => alive && setError((e as Error).message));
    api.health().then((h) => alive && setHealth(h), () => undefined);
    return () => { alive = false; };
  }, [api]);

  return (
    <>
      <PageHead title={copy.title} intro={copy.intro} eyebrow={<><Icon name="layers" />Data and health</>} />
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {!data && !error && <Loading>{copy.loading}</Loading>}
      {data && <DataCards data={data} />}
      {health && <HealthCard health={health} />}
    </>
  );
}
