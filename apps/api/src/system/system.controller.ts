import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard, CurrentLearner } from "../auth/auth.guard";
import { DbService } from "../db/db.service";
import { HealthDto, SystemDto, TraceEntryDto } from "../dto";
import { PythonClient } from "../python/python-client";
import { TraceService } from "../trace/trace.service";

export const OWNERSHIP = [
  { schema: "app", owner: "NestJS gateway", holds: "learners, which episodes each learner owns, glossary" },
  { schema: "research", owner: "Python service", holds: "episodes, guesses, backtests, studies" },
  { schema: "market", owner: "Python service", holds: "prices, corporate actions, macro series, data checks" },
];

@ApiTags("System")
@Controller()
export class SystemController {
  constructor(private readonly db: DbService, private readonly py: PythonClient, private readonly trace: TraceService) {}

  async health(): Promise<HealthDto> {
    const [database, python] = await Promise.all([
      this.db.query("SELECT 1").then(() => "ok", () => "down"),
      this.py.health().then((ok) => (ok ? "ok" : "down")),
    ]);
    return { status: "ok", gateway: "ok", database, python };
  }

  /** Public and cheap: lets the page show WHICH part is down. Always answers 200. */
  @Get("health")
  @ApiOperation({ summary: "Is the front desk running? And its database and the number service?" })
  @ApiOkResponse({ type: HealthDto })
  getHealth() {
    return this.health();
  }

  @Get("system")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Status, versions and who owns which database schema" })
  @ApiOkResponse({ type: SystemDto })
  async system(): Promise<SystemDto> {
    const health = await this.health();
    const one = async (sql: string): Promise<string | null> => {
      try {
        const r = await this.db.query(sql);
        return r.rows[0] ? String(Object.values(r.rows[0])[0]) : null;
      } catch {
        return null; // schema or table not there yet
      }
    };
    return {
      health,
      app_migration: await one("SELECT name FROM app.pgmigrations ORDER BY id DESC LIMIT 1"),
      python_migration: await one("SELECT version_num FROM market.alembic_version LIMIT 1"),
      ownership: OWNERSHIP,
      checked_at: new Date().toISOString(),
    };
  }

  @Get("trace")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "What my recent requests did (route patterns, times and statuses only)" })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ type: [TraceEntryDto] })
  async getTrace(@CurrentLearner() me: string, @Query("limit") limit?: string) {
    return await this.trace.last(me, limit ? Number(limit) : 50);
  }
}
