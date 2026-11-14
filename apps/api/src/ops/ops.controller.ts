import { Controller, Get, Headers, HttpException, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard";
import { DataStatusDto, MetricsDto } from "../dto";
import { OpsService } from "./ops.service";

@ApiTags("Operations")
@Controller()
export class OpsController {
  constructor(private readonly svc: OpsService) {}

  @Get("metrics")
  @ApiOperation({ summary: "For the person running MarketLab: calls, error counts and p50, p95, max duration per route (needs the operator token, never a learner token)" })
  @ApiHeader({ name: "x-operator-token", required: true })
  @ApiQuery({ name: "hours", required: false, description: "1 to 168, default 24" })
  @ApiOkResponse({ type: MetricsDto })
  async metrics(@Headers("x-operator-token") token: string | undefined, @Query("hours") hours?: string) {
    if (!this.svc.operatorAllowed(token)) throw new HttpException("Operator token required.", 401);
    const h = hours === undefined ? 24 : Number(hours);
    if (!Number.isInteger(h) || h < 1 || h > 168) throw new HttpException("hours must be a whole number from 1 to 168.", 422);
    return this.svc.metrics(h);
  }

  @Get("data/status")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "What data MarketLab holds: sources, coverage, freshness, quality checks and caveats (no file paths, hashes or keys)" })
  @ApiOkResponse({ type: DataStatusDto })
  dataStatus() {
    return this.svc.dataStatus();
  }
}
