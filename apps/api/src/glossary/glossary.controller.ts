import { Controller, Get, Injectable, NotFoundException, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { DbService } from "../db/db.service";
import { GlossaryTermDto } from "../dto";

const COLUMNS = "slug, term, plain_definition, example, level, category, related, source";

@Injectable()
export class GlossaryService {
  constructor(private readonly db: DbService) {}

  async list(q?: string, category?: string): Promise<GlossaryTermDto[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q && q.trim()) {
      params.push(`%${q.trim().replace(/[%_]/g, "")}%`);
      where.push(`(term ILIKE $${params.length} OR plain_definition ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    const r = await this.db.query(`SELECT ${COLUMNS} FROM app.glossary_term ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY term`, params);
    return r.rows;
  }

  async get(slug: string): Promise<GlossaryTermDto> {
    const r = await this.db.query(`SELECT ${COLUMNS} FROM app.glossary_term WHERE slug = $1`, [slug]);
    if (!r.rows[0]) throw new NotFoundException("We do not have a definition for that word yet.");
    return r.rows[0];
  }
}

/** Public: definitions are not secret and are shown before sign-in. */
@ApiTags("Glossary")
@Controller("glossary")
export class GlossaryController {
  constructor(private readonly svc: GlossaryService) {}

  @Get()
  @ApiOperation({ summary: "Words and their plain-language meaning (search with q, filter with category)" })
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "category", required: false, description: "learning (words used on the screens) or general" })
  @ApiOkResponse({ type: [GlossaryTermDto] })
  list(@Query("q") q?: string, @Query("category") category?: string) {
    return this.svc.list(q, category);
  }

  @Get(":slug")
  @ApiOperation({ summary: "One word" })
  @ApiOkResponse({ type: GlossaryTermDto })
  get(@Param("slug") slug: string) {
    return this.svc.get(slug);
  }
}
