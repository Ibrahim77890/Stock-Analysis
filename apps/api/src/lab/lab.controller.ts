import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, CurrentLearner } from "../auth/auth.guard";
import { CreateStudyDto, LabRunDto, RunDto, StocksDto, StudyCreatedDto, StudyListItemDto, StudyOverviewDto, VaultDto, VaultResultDto } from "../dto";
import { LabService } from "./lab.service";

@ApiTags("Lab")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("lab")
export class LabController {
  constructor(private readonly svc: LabService) {}

  @Get("stocks")
  @ApiOperation({ summary: "Stocks you can study (at least 12 years of daily prices)" })
  @ApiOkResponse({ type: StocksDto })
  stocks() {
    return this.svc.stocks();
  }

  @Post("studies")
  @HttpCode(200)
  @ApiOperation({ summary: "Start a study on one stock. Part of its history is locked in a vault." })
  @ApiOkResponse({ type: StudyCreatedDto })
  create(@CurrentLearner() me: string, @Body() dto: CreateStudyDto) {
    return this.svc.create(me, dto);
  }

  @Get("studies")
  @ApiOperation({ summary: "My studies, newest first" })
  @ApiOkResponse({ type: [StudyListItemDto] })
  list(@CurrentLearner() me: string) {
    return this.svc.list(me);
  }

  @Get("studies/:id")
  @ApiOperation({ summary: "One of my studies: ideas tried and whether the vault is open" })
  @ApiOkResponse({ type: StudyOverviewDto })
  overview(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.overview(me, id);
  }

  @Post("studies/:id/runs")
  @HttpCode(200)
  @ApiOperation({ summary: "Try a rule on the practice years. A new rule counts as one idea tried." })
  @ApiOkResponse({ type: LabRunDto })
  run(@CurrentLearner() me: string, @Param("id") id: string, @Body() dto: RunDto) {
    return this.svc.run(me, id, dto);
  }

  @Post("studies/:id/vault")
  @HttpCode(200)
  @ApiOperation({ summary: "Open the vault with one rule you already tried. It can be done only once." })
  @ApiOkResponse({ type: VaultResultDto })
  vault(@CurrentLearner() me: string, @Param("id") id: string, @Body() dto: VaultDto) {
    return this.svc.vault(me, id, dto);
  }

  @Get("studies/:id/vault")
  @ApiOperation({ summary: "The saved result of a vault that was already opened" })
  @ApiOkResponse({ type: VaultResultDto })
  savedVault(@CurrentLearner() me: string, @Param("id") id: string) {
    return this.svc.savedVault(me, id);
  }
}
