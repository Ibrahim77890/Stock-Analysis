import { HttpException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Limiter, LimiterFactory } from "../limits/db-rate-limiter";
import { Spec } from "../common/pick";
import { clean } from "../learning/whitelist";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { DbService } from "../db/db.service";
import { CreateStudyDto, RunDto, VaultDto } from "../dto";
import { PythonClient } from "../python/python-client";
import { CARD, CARDS, CREATED, OVERVIEW, RUN, STOCKS, VAULT } from "./whitelist";

const NOT_FOUND = "That study was not found.";
export const MAX_STUDIES_PER_LEARNER = 20;
export const VAULT_CALLS_PER_MINUTE = 3;

/** 429 with a Retry-After header (the exception filter writes the header). */
export class TooManyRequests extends HttpException {
  constructor(message: string, readonly retryAfter: number) {
    super({ statusCode: 429, message }, 429);
  }
}

/** Separate from the login limiter: expensive runs and the vault have their own counters per learner. */
export class LabLimiters {
  readonly runs: Limiter;
  readonly vault: Limiter;
  constructor(factory: LimiterFactory, runsPerMinute: number) {
    this.runs = factory.make("lab-run", runsPerMinute);
    this.vault = factory.make("lab-vault", VAULT_CALLS_PER_MINUTE);
  }
}

@Injectable()
export class LabService {
  private readonly log = new Logger("Lab");

  constructor(
    private readonly db: DbService,
    private readonly py: PythonClient,
    private readonly limits: LabLimiters,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Another learner's id, an unknown id and a malformed id all give the SAME 404 and never call Python. */
  async assertOwns(learnerId: string, raw: string): Promise<number> {
    if (!/^\d{1,12}$/.test(raw)) throw new NotFoundException(NOT_FOUND);
    const id = Number(raw);
    const r = await this.db.query("SELECT 1 FROM app.learner_study WHERE learner_id = $1 AND study_id = $2", [learnerId, id]);
    if (r.rowCount === 0) throw new NotFoundException(NOT_FOUND);
    return id;
  }

  private shape<T>(value: any, spec: Spec, what: string): T {
    const out = clean<T>(value, spec);
    if (out.dropped.length) this.log.warn(`dropped unexpected upstream fields in ${what}: ${out.dropped.join(", ")}`); // names only
    return out.value;
  }

  private async throttle(limiter: Limiter, learnerId: string, what: string): Promise<void> {
    if (!(await limiter.allow(learnerId))) {
      const wait = await limiter.retryAfterSeconds(learnerId);
      throw new TooManyRequests(`You are going a little fast. Please wait ${wait} seconds before the next ${what}.`, wait);
    }
  }

  private checkRule(fast: number, slow: number): void {
    if (fast >= slow) throw new UnprocessableEntityException("The short average must be shorter than the long average.");
  }

  async stocks() {
    return this.shape<any>(await this.py.labStocks(), STOCKS, "stocks");
  }

  async create(learnerId: string, dto: CreateStudyDto) {
    const n = await this.db.query("SELECT count(*)::int AS n FROM app.learner_study WHERE learner_id = $1", [learnerId]);
    if (n.rows[0].n >= MAX_STUDIES_PER_LEARNER) {
      throw new UnprocessableEntityException(`You can have at most ${MAX_STUDIES_PER_LEARNER} studies. Please use one of the ones you have.`);
    }
    const made = await this.py.labCreate({ symbol: dto.symbol.toUpperCase(), ...(dto.name ? { name: dto.name } : {}) });
    await this.db.query("INSERT INTO app.learner_study (learner_id, study_id, symbol) VALUES ($1, $2, $3)", [learnerId, made.study_id, String(made.symbol)]);
    return this.shape<any>(made, CREATED, "create");
  }

  async list(learnerId: string) {
    const rows = await this.db.query("SELECT study_id, created_at FROM app.learner_study WHERE learner_id = $1 ORDER BY created_at DESC, study_id DESC", [learnerId]);
    if (rows.rowCount === 0) return [];
    const upstream = this.shape<any>(await this.py.labInfo(rows.rows.map((r) => Number(r.study_id))), CARDS, "list");
    const byId = new Map<number, any>(upstream.studies.map((s: any) => [s.study_id, s]));
    const out: any[] = [];
    for (const row of rows.rows) {
      const card = byId.get(Number(row.study_id));
      if (card) out.push({ ...this.shape<any>(card, CARD, "card"), created_at: new Date(row.created_at).toISOString() });
    }
    return out;
  }

  async overview(learnerId: string, rawId: string) {
    const id = await this.assertOwns(learnerId, rawId);
    return this.shape<any>(await this.py.labOverview(id), OVERVIEW, "overview");
  }

  async run(learnerId: string, rawId: string, dto: RunDto) {
    this.checkRule(dto.fast, dto.slow);
    const id = await this.assertOwns(learnerId, rawId);
    await this.throttle(this.limits.runs, learnerId, "run");
    const body = { fast: dto.fast, slow: dto.slow, cost_bps: dto.cost_bps ?? 2, seed: dto.seed ?? 1, n_paths: dto.n_paths ?? 100 };
    const out = this.shape<any>(await this.py.labRun(id, body), RUN, "run");
    if (out.overfitting_meter === null) delete out.overfitting_meter; // absent, not null, until there are two ideas
    return out;
  }

  async vault(learnerId: string, rawId: string, dto: VaultDto) {
    this.checkRule(dto.fast, dto.slow);
    const id = await this.assertOwns(learnerId, rawId);
    await this.throttle(this.limits.vault, learnerId, "try");
    const out = await this.py.labVault(id, { fast: dto.fast, slow: dto.slow, cost_bps: dto.cost_bps });
    return this.shape<any>(out, VAULT, "vault"); // the only place vault numbers may pass
  }

  async savedVault(learnerId: string, rawId: string) {
    const id = await this.assertOwns(learnerId, rawId);
    return this.shape<any>(await this.py.labSavedVault(id), VAULT, "saved vault");
  }
}
