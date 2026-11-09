import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Stock, StudyListItem } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Rich } from "../components/Term";
import { Button, Callout, Card, Chip, EmptyState, ErrorMessage, Loading, PageHead } from "../components/ui";
import { lab } from "../copy/lab";

export function StockPicker({ stocks, value, onChange }: { stocks: Stock[]; value: string | null; onChange: (symbol: string) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? stocks.filter((s) => s.symbol.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)) : stocks;
  }, [q, stocks]);
  return (
    <div>
      <div className="field input-wrap">
        <Icon name="search" />
        <label className="sr-only" htmlFor="stock-search">{lab.searchLabel}</label>
        <input id="stock-search" type="search" placeholder={lab.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="stock-list" role="group" aria-label={lab.pickStock}>
        {shown.map((s) => (
          <button type="button" key={s.symbol} className="stock-btn" aria-pressed={value === s.symbol} onClick={() => onChange(s.symbol)}>
            <span className="sym">{s.symbol}</span>
            <span className="nm">{s.name}</span>
            <span className="nm">{lab.yearsOfData(s.years.toFixed(1))}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="muted">No stock matches that search.</p>}
    </div>
  );
}

export function LabHome() {
  const { api } = useAuth();
  const nav = useNavigate();
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [studies, setStudies] = useState<StudyListItem[] | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.labStocks().then((r) => setStocks(r.stocks), (e) => setError(e.message));
    api.labStudies().then(setStudies, (e) => setError(e.message));
  }, [api]);

  async function start() {
    if (!symbol || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.labCreate(symbol);
      nav(`/lab/${s.study_id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={lab.title} intro={lab.intro} eyebrow={<><Icon name="lab" />Strategy lab</>} />

      <div className="grid">
        <Card title={lab.whatTitle}>
          <ul className="how-list">
            <li><Icon name="check" /><span>{lab.whatIs}</span></li>
            <li><Icon name="warn" /><span>{lab.whatIsNot}</span></li>
          </ul>
        </Card>
        <Card title={lab.stepsTitle}>
          <ol className="how-list">
            {lab.steps.map((s, i) => (
              <li key={s.head}><span className="chip accent" aria-hidden="true">{i + 1}</span><span><strong>{s.head}.</strong> <Rich text={s.body} /></span></li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title={lab.startTitle}>
        <p className="muted">{lab.vaultNote}</p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {!stocks && !error && <Loading />}
        {stocks && stocks.length === 0 && <EmptyState>{lab.noStocks}</EmptyState>}
        {stocks && stocks.length > 0 && <StockPicker stocks={stocks} value={symbol} onChange={setSymbol} />}
        <div style={{ marginTop: "1rem" }}>
          <Button size="big" disabled={!symbol || busy} onClick={start}>{busy ? lab.starting : lab.startButton}<Icon name="arrow" /></Button>
          {!symbol && stocks && stocks.length > 0 && <span className="muted"> Choose a stock first.</span>}
        </div>
      </Card>

      <h2 className="section-title">{lab.yourStudies}</h2>
      {!studies && !error && <Loading />}
      {studies && studies.length === 0 && <EmptyState>{lab.noStudies}</EmptyState>}
      {studies && studies.length > 0 && (
        <div className="grid" role="list" aria-label={lab.yourStudies}>
          {studies.map((s) => (
            <article className="card" key={s.study_id} role="listitem">
              <div className="card-head">
                <h3>{s.symbol}</h3>
                {s.vault_open ? <Chip kind="ok">{lab.vaultOpened}</Chip> : <Chip kind="accent">{lab.vaultLocked}</Chip>}
              </div>
              <p className="muted">{s.name}. {lab.yearsLabel(s.practice_years)}.</p>
              <p><Chip>{lab.ideasTried(s.ideas_tried)}</Chip></p>
              <Link className="btn secondary small" to={`/lab/${s.study_id}`}>{lab.open}</Link>
            </article>
          ))}
        </div>
      )}
      <Callout kind="careful">{lab.whatIsNot}</Callout>
    </>
  );
}
