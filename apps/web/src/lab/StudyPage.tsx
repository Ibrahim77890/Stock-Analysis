import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, LabRun, RuleInput, StudyOverview, VaultResult } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { Callout, Chip, ErrorMessage, Loading, PageHead } from "../components/ui";
import { lab } from "../copy/lab";
import { IdeasTried } from "./IdeasTried";
import { Results } from "./Results";
import { RuleForm } from "./RuleForm";
import { VaultPanel } from "./VaultPanel";

const friendly = (e: unknown): string => {
  if (e instanceof ApiError && lab.errors[e.status] && e.status !== 422) return lab.errors[e.status];
  return (e as Error).message;
};

export function StudyPage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const [study, setStudy] = useState<StudyOverview | null>(null);
  const [run, setRun] = useState<LabRun | null>(null);
  const [vault, setVault] = useState<VaultResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);

  const reload = useCallback(async () => {
    const s = await api.labStudy(id);
    setStudy(s);
    return s;
  }, [api, id]);

  useEffect(() => {
    let alive = true;
    reload().then(async (s) => {
      if (alive && s.vault_open) setVault(await api.labSavedVault(id));
    }).catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [reload, api, id]);

  async function doRun(rule: RuleInput) {
    setBusy(true);
    setRunError(null);
    try {
      setRun(await api.labRun(id, { ...rule, seed: 1, n_paths: 100 }));
      await reload();
    } catch (e) {
      setRunError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  async function openVault(t: StudyOverview["trials"][number]) {
    setVaultBusy(true);
    setVaultError(null);
    try {
      setVault(await api.labVault(id, { fast: t.fast, slow: t.slow, cost_bps: t.cost_bps }));
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try { setVault(await api.labSavedVault(id)); await reload(); return; } catch (e2) { setVaultError(friendly(e2)); }
      } else {
        setVaultError(friendly(e));
      }
    } finally {
      setVaultBusy(false);
    }
  }

  if (error && !study) return <ErrorMessage>{error}</ErrorMessage>;
  if (!study) return <Loading />;

  const activeKey = run ? `${run.params.fast}/${run.params.slow}/${run.params.cost_bps}` : undefined;
  const ideas = (
    <IdeasTried study={study} meter={run?.overfitting_meter ?? null} activeKey={activeKey}
      onPick={(t) => doRun({ fast: t.fast, slow: t.slow, cost_bps: t.cost_bps })} />
  );
  return (
    <>
      <PageHead title={`${study.symbol} study`} eyebrow={<><Icon name="lab" />Strategy lab</>}
        intro={<>{lab.yearsLabel(study.practice_years)}. {lab.ideasTried(study.ideas_tried)}.</>}>
        {study.vault_open ? <Chip kind="ok">{lab.vaultOpened}</Chip> : <Chip kind="accent">{lab.vaultLocked}</Chip>}
        <Link className="btn ghost small" to="/lab">All studies</Link>
      </PageHead>
      <div className="episode-grid">
        <div className="stack">
          {runError && <ErrorMessage>{runError}</ErrorMessage>}
          {run ? (
            <Results run={run} notice={run.counted ? null : lab.alreadyCounted}
              extra={ideas} />
          ) : (
            <>
              <Callout kind="info">Write a rule on the right and run it. The results appear here.</Callout>
              {ideas}
            </>
          )}
          {vault && <VaultPanel study={study} vault={vault} error={null} busy={false} onOpen={openVault} />}
        </div>
        <div className="sticky stack">
          <RuleForm busy={busy} onRun={doRun} initial={run ? { fast: run.params.fast, slow: run.params.slow, cost_bps: run.params.cost_bps } : undefined} />
          {!vault && <VaultPanel study={study} vault={null} error={vaultError} busy={vaultBusy} onOpen={openVault} />}
        </div>
      </div>
    </>
  );
}
