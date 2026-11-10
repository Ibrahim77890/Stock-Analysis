import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard, CurrentLearner } from "../auth/auth.guard";
import { DecisionDto, DecisionInDto, IndicatorDto, JournalDto } from "../dto";
import { JournalService } from "./journal.service";

@ApiTags("Journal")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("episodes")
export class JournalController {
  constructor(private readonly svc: JournalService) {}

  @Get(":id/indicators")
  @ApiOperation({ summary: "An indicator (sma, ema or rsi) for the days already revealed. It describes the past; it does not forecast." })
  @ApiQuery({ name: "name", enum: ["sma", "ema", "rsi"] })
  @ApiQuery({ name: "window", required: false, description: "2 to 200, default 20" })
  @ApiOkResponse({ type: IndicatorDto })
  indicators(@CurrentLearner() me: string, @Param("id") id: string, @Query("name") name: string, @Query("window") window?: string) {
    return this.svc.indicators(me, id, name, window === undefined ? 20 : Number(window));
  }

  @Post(":id/decisions")
  @HttpCode(200)
  @ApiOperation({ summary: "Record a practice decision (long or flat) with a reason. Stored once and never edited; limited to 30 a minute." })
  @ApiOkResponse({ type: DecisionDto })
  record(@CurrentLearner() me: string, @Param("id") id: string, @Body() dto: DecisionInDto) {
    return this.svc.record(me, id, dto);
  }

  @Get(":id/decisions")
  @ApiOperation({ summary: "My decisions on this episode with results so far (only days already revealed)" })
  @ApiOkResponse({ type: JournalDto })
  journal(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.journal(me, id);
  }
}
