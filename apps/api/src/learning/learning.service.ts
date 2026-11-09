import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Spec } from "../common/pick";
import { DbService } from "../db/db.service";
import { AdvanceDto, CreateEpisodeDto, PredictionDto } from "../dto";
import { PythonClient } from "../python/python-client";
import { BARS, clean, PREDICTION_ONE, PREDICTIONS, PROGRESS, REVEAL, SCORE, STATE } from "./whitelist";

const NOT_FOUND = "That episode was not found.";

@Injectable()
export class LearningService {
  private readonly log = new Logger("Learning");

  constructor(private readonly db: DbService, private readonly py: PythonClient) {}

  /** Ownership check. Another learner's id and an unknown id give the SAME 404 (never 403), and no call to Python. */
  async assertOwns(learnerId: string, episodeId: string): Promise<void> {
    const r = await this.db.query("SELECT 1 FROM app.learner_episode WHERE learner_id = $1 AND episode_id = $2", [learnerId, episodeId]);
    if (r.rowCount === 0) throw new NotFoundException(NOT_FOUND);
  }

  private shape<T>(raw: any, spec: Spec, what: string): T {
    const { value, dropped } = clean<T>(raw, spec);
    if (dropped.length) this.log.warn(`dropped unexpected upstream fields in ${what}: ${dropped.join(", ")}`); // names only
    return value;
  }

  private fixKind(state: any) {
    // a mixed episode that is still open never shows its kind, even if upstream sent it
    if (state && state.kind_requested === "mixed" && state.status !== "revealed") delete state.kind;
    return state;
  }

  async create(learnerId: string, dto: CreateEpisodeDto) {
    const body = { kind: dto.kind ?? "mixed", n_bars: dto.n_bars ?? 250, initial_visible: dto.initial_visible ?? 60, ...(dto.seed !== undefined ? { seed: dto.seed } : {}) };
    const state = await this.py.createEpisode(body);
    await this.db.query("INSERT INTO app.learner_episode (learner_id, episode_id) VALUES ($1, $2)", [learnerId, state.episode_id]);
    return this.fixKind(this.shape<any>(state, STATE, "create"));
  }

  async list(learnerId: string) {
    const rows = await this.db.query("SELECT episode_id, created_at FROM app.learner_episode WHERE learner_id = $1 ORDER BY created_at DESC", [learnerId]);
    if (rows.rowCount === 0) return [];
    const upstream = await this.py.states(rows.rows.map((r) => r.episode_id as string)); // one call, not one per episode
    const byId = new Map<string, any>(upstream.episodes.map((e: any) => [e.episode_id, e]));
    const out: any[] = [];
    for (const row of rows.rows) {
      const raw = byId.get(row.episode_id);
      if (!raw) continue; // the Python side no longer has it: skip
      out.push({ ...this.fixKind(this.shape<any>(raw, STATE, "list")), created_at: new Date(row.created_at).toISOString() });
    }
    return out;
  }

  async state(learnerId: string, id: string) {
    await this.assertOwns(learnerId, id);
    return this.fixKind(this.shape<any>(await this.py.getEpisode(id), STATE, "state"));
  }

  async bars(learnerId: string, id: string) {
    await this.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.bars(id), BARS, "bars");
  }

  async advance(learnerId: string, id: string, dto: AdvanceDto) {
    await this.assertOwns(learnerId, id);
    return this.fixKind(this.shape<any>(await this.py.advance(id, dto.n ?? 1), STATE, "advance"));
  }

  async addPrediction(learnerId: string, id: string, dto: PredictionDto) {
    await this.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.addPrediction(id, dto.horizon, dto.p_up), PREDICTION_ONE, "prediction");
  }

  async predictions(learnerId: string, id: string) {
    await this.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.predictions(id), PREDICTIONS, "predictions");
  }

  async score(learnerId: string, id: string) {
    await this.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.score(id), SCORE, "score");
  }

  async reveal(learnerId: string, id: string) {
    await this.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.reveal(id), REVEAL, "reveal"); // the only place identity may pass
  }

  async progress(learnerId: string) {
    const rows = await this.db.query("SELECT episode_id FROM app.learner_episode WHERE learner_id = $1", [learnerId]);
    const ids = rows.rows.map((r) => r.episode_id as string);
    const raw = ids.length ? await this.py.summary(ids) : null;
    const value = raw ? this.shape<any>(raw, PROGRESS, "progress") : { overall: emptyOverall(), by_kind: { real: { n: 0, brier: null }, synthetic: { n: 0, brier: null } }, by_horizon: { "1": { n: 0, brier: null }, "5": { n: 0, brier: null }, "10": { n: 0, brier: null } } };
    return { ...value, episodes: ids.length };
  }
}

function emptyOverall() {
  return { n: 0, brier: null, skill_vs_coin_flip: null, log_loss: null, enough: false, min_enough: 30,
    warnings: ["too few resolved predictions to say anything (need 30, have 0)"],
    baselines: { coin_flip: 0.25, base_rate: null, base_rate_note: "in-sample: it uses the outcomes it is compared with, so it flatters" },
    luck: { real_brier: null, luck_probability: null, n_perm: 0, seed: 1, count: 0, not_reported: true, shuffled_quantiles: null } };
}
