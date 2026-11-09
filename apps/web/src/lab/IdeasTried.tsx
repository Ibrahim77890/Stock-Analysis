import type { LabRun, StudyOverview } from "../api/client";
import { Card, Chip, EmptyState } from "../components/ui";
import { lab } from "../copy/lab";
import { pctSigned, ratio } from "../lib/format";

type Meter = NonNullable<LabRun["overfitting_meter"]>;

/** Every different rule tried is listed; the meter appears from the second idea on. */
export function IdeasTried({ study, meter, onPick, activeKey }: { study: StudyOverview; meter: Meter | null; onPick?: (t: StudyOverview["trials"][number]) => void; activeKey?: string }) {
  const trials = study.trials;
  return (
    <Card title={lab.ideasTitle}>
      <div className="row" style={{ marginBottom: "0.6rem" }}>
        <Chip kind="accent">{lab.ideasTried(study.ideas_tried)}</Chip>
        <span className="muted">{lab.ideasIntro}</span>
      </div>
      {trials.length === 0 ? <EmptyState>{lab.ideasNone}</EmptyState> : (
        <div className="table-wrap">
          <table aria-label={lab.ideasTitle}>
            <thead>
              <tr><th>{lab.ideasCol.n}</th><th>{lab.ideasCol.rule}</th><th className="num">{lab.ideasCol.change}</th><th className="num">{lab.ideasCol.sharpe}</th><th className="num">{lab.ideasCol.trades}</th>{onPick && <th />}</tr>
            </thead>
            <tbody>
              {trials.map((t) => {
                const key = `${t.fast}/${t.slow}/${t.cost_bps}`;
                return (
                  <tr key={t.order} className={key === activeKey ? "mark" : undefined}>
                    <td>{t.order}</td><td style={{ whiteSpace: "nowrap" }}>{t.fast} / {t.slow} days, {t.cost_bps} bps</td>
                    <td className="num">{pctSigned(t.total_return, 0)}</td><td className="num">{ratio(t.sharpe)}</td><td className="num">{t.trades ?? "-"}</td>
                    {onPick && <td><button type="button" className="btn ghost small" onClick={() => onPick(t)}>Show again</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {meter && (
        <p className="hint" style={{ marginTop: "0.8rem" }}>
          {lab.ideasMeterDetail.replace("{best}", ratio(meter.best_sharpe)).replace("{luck}", ratio(meter.expected_best_sharpe_by_luck))}
        </p>
      )}
    </Card>
  );
}
