import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, CurrentLearner } from "../auth/auth.guard";
import { AdvanceDto, BarsDto, CreateEpisodeDto, EpisodeListItemDto, EpisodeStateDto, PredictionDto, PredictionItemDto, PredictionsDto, ProgressDto, RevealDto, ScoreDto } from "../dto";
import { LearningService } from "./learning.service";

@ApiTags("Learning")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class LearningController {
  constructor(private readonly svc: LearningService) {}

  @Post("episodes")
  @HttpCode(200)
  @ApiOperation({ summary: "Start a blind episode (name, dates and price level are hidden until you reveal)" })
  @ApiOkResponse({ type: EpisodeStateDto })
  create(@CurrentLearner() me: string, @Body() dto: CreateEpisodeDto) {
    return this.svc.create(me, dto);
  }

  @Get("episodes")
  @ApiOperation({ summary: "My episodes, newest first" })
  @ApiOkResponse({ type: [EpisodeListItemDto] })
  list(@CurrentLearner() me: string) {
    return this.svc.list(me);
  }

  @Get("episodes/:id")
  @ApiOperation({ summary: "State of one of my episodes" })
  @ApiOkResponse({ type: EpisodeStateDto })
  state(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.state(me, id);
  }

  @Get("episodes/:id/bars")
  @ApiOperation({ summary: "The blind chart up to today (day numbers, price starts at 100)" })
  @ApiOkResponse({ type: BarsDto })
  bars(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.bars(me, id);
  }

  @Post("episodes/:id/advance")
  @HttpCode(200)
  @ApiOperation({ summary: "Move forward 1 to 20 days; waiting guesses are answered when their day arrives" })
  @ApiOkResponse({ type: EpisodeStateDto })
  advance(@CurrentLearner() me: string, @Param("id") id: string, @Body() dto: AdvanceDto) {
    return this.svc.advance(me, id, dto);
  }

  @Post("episodes/:id/predictions")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a guess. It cannot be changed afterwards." })
  @ApiOkResponse({ type: PredictionItemDto })
  addPrediction(@CurrentLearner() me: string, @Param("id") id: string, @Body() dto: PredictionDto) {
    return this.svc.addPrediction(me, id, dto);
  }

  @Get("episodes/:id/predictions")
  @ApiOperation({ summary: "My guesses in this episode" })
  @ApiOkResponse({ type: PredictionsDto })
  predictions(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.predictions(me, id);
  }

  @Get("episodes/:id/score")
  @ApiOperation({ summary: "Score so far: Brier score, calibration groups, luck check, warnings" })
  @ApiOkResponse({ type: ScoreDto })
  score(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.score(me, id);
  }

  @Post("episodes/:id/reveal")
  @HttpCode(200)
  @ApiOperation({ summary: "Reveal what the episode was. One way: it ends the episode." })
  @ApiOkResponse({ type: RevealDto })
  reveal(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.reveal(me, id);
  }

  @Get("me/progress")
  @ApiOperation({ summary: "My results across all my episodes" })
  @ApiOkResponse({ type: ProgressDto })
  progress(@CurrentLearner() me: string) {
    return this.svc.progress(me);
  }
}
