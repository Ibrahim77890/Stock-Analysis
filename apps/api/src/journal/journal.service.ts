import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { Spec } from "../common/pick";
import { clean } from "../learning/whitelist";
import { LearningService } from "../learning/learning.service";
import { DecisionInDto } from "../dto";
import { Limiter } from "../limits/db-rate-limiter";
import { TooManyRequests } from "../lab/lab.service";
import { PythonClient } from "../python/python-client";
import { DECISION_ONE, INDICATOR, JOURNAL } from "./whitelist";

export const DECISION_LIMITER = "DECISION_LIMITER";
export const DECISIONS_PER_MINUTE = 30;

@Injectable()
export class JournalService {
  private readonly log = new Logger("Journal");

  constructor(
    private readonly learning: LearningService,
    private readonly py: PythonClient,
    @Inject(DECISION_LIMITER) private readonly limiter: Limiter,
  ) {}

  private shape<T>(value: any, spec: Spec, what: string): T {
    const out = clean<T>(value, spec);
    if (out.dropped.length) this.log.warn(`dropped unexpected upstream fields in ${what}: ${out.dropped.join(", ")}`); // names only
    return out.value;
  }

  async indicators(learnerId: string, id: string, name: string, window: number) {
    await this.learning.assertOwns(learnerId, id); // another learner's id and an unknown id give the same 404 first
    if (!["sma", "ema", "rsi"].includes(name)) throw new HttpException("Please choose the 20-day average, the EMA or the RSI.", 422);
    if (!Number.isInteger(window) || window < 2 || window > 200) throw new HttpException("The window must be a whole number from 2 to 200.", 422);
    return this.shape<any>(await this.py.indicators(id, name, window), INDICATOR, "indicators");
  }

  async record(learnerId: string, id: string, dto: DecisionInDto) {
    await this.learning.assertOwns(learnerId, id);
    if (!(await this.limiter.allow(learnerId))) {
      const wait = await this.limiter.retryAfterSeconds(learnerId);
      throw new TooManyRequests(`You are going a little fast. Please wait ${wait} seconds before the next decision.`, wait);
    }
    const body = { stance: dto.stance, reason: dto.reason, client_key: dto.client_key, cost_bps: dto.cost_bps ?? 2 };
    return this.shape<any>(await this.py.recordDecision(id, body), DECISION_ONE, "decision");
  }

  async journal(learnerId: string, id: string) {
    await this.learning.assertOwns(learnerId, id);
    return this.shape<any>(await this.py.decisions(id), JOURNAL, "journal");
  }
}
