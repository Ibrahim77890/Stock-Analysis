import { Injectable, OnModuleInit } from "@nestjs/common";
import { DbService } from "../db/db.service";

/** What every limiter offers. The in-memory class and the database class both fit. */
export interface Limiter {
  allow(key: string): boolean | Promise<boolean>;
  retryAfterSeconds(key: string): number | Promise<number>;
}

export const WINDOW_SECONDS = 60;
const KEEP_MINUTES = 10;
const CLEANUP_EVERY_MS = 60_000;

/**
 * One limiter for one kind of action. The check and the insert happen in one transaction that holds an
 * advisory lock for (kind, key), so two simultaneous requests cannot both take the last slot.
 * Refused calls are not stored.
 */
export class DbKindLimiter implements Limiter {
  constructor(private readonly db: DbService, private readonly kind: string, private readonly limit: number, private readonly tick?: () => void) {}

  async allow(key: string): Promise<boolean> {
    this.tick?.();
    const client = await this.db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${this.kind}:${key}`]);
      const r = await client.query(
        `WITH recent AS (
           SELECT count(*)::int AS c FROM app.rate_event
            WHERE key = $1 AND kind = $2 AND at > clock_timestamp() - make_interval(secs => $4)
         )
         INSERT INTO app.rate_event (key, kind) SELECT $1, $2 FROM recent WHERE c < $3 RETURNING id`,
        [key, this.kind, this.limit, WINDOW_SECONDS],
      );
      await client.query("COMMIT");
      return (r.rowCount ?? 0) > 0;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Whole seconds until the oldest counted call leaves the window (at least 1). */
  async retryAfterSeconds(key: string): Promise<number> {
    const r = await this.db.query(
      `SELECT ceil($3 - extract(epoch FROM (clock_timestamp() - min(at))))::int AS wait
         FROM app.rate_event WHERE key = $1 AND kind = $2 AND at > clock_timestamp() - make_interval(secs => $3)`,
      [key, this.kind, WINDOW_SECONDS],
    );
    const wait = r.rows[0]?.wait;
    return typeof wait === "number" && wait > 0 ? wait : 1;
  }

  /** Rows currently counted for a key (used by tests: counted must equal accepted). */
  async counted(key: string): Promise<number> {
    const r = await this.db.query(
      "SELECT count(*)::int AS n FROM app.rate_event WHERE key = $1 AND kind = $2 AND at > clock_timestamp() - make_interval(secs => $3)",
      [key, this.kind, WINDOW_SECONDS],
    );
    return r.rows[0].n;
  }
}

@Injectable()
export class LimiterFactory implements OnModuleInit {
  private lastCleanup = 0;
  constructor(private readonly db: DbService) {}

  make(kind: string, limit: number): DbKindLimiter {
    return new DbKindLimiter(this.db, kind, limit, () => void this.cleanup().catch(() => undefined));
  }

  async onModuleInit(): Promise<void> {
    await this.cleanup(true).catch(() => undefined); // a database that is down must not stop the app from starting
  }

  /** Removes rows older than ten minutes; runs at most once a minute unless forced. Returns rows removed. */
  async cleanup(force = false): Promise<number> {
    const now = Date.now();
    if (!force && now - this.lastCleanup < CLEANUP_EVERY_MS) return 0;
    this.lastCleanup = now;
    const r = await this.db.query("DELETE FROM app.rate_event WHERE at < clock_timestamp() - make_interval(mins => $1)", [KEEP_MINUTES]);
    return r.rowCount ?? 0;
  }
}
