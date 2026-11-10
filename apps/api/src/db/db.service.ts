import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, QueryResult, QueryResultRow } from "pg";
import { APP_CONFIG, AppConfig } from "../config/app-config";

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = new Pool({ connectionString: cfg.databaseUrl, max: 10, connectionTimeoutMillis: 8000, query_timeout: 10_000 });
  }

  query<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as any[]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
