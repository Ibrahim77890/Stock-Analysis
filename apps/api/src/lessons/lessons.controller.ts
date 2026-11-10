import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard, CurrentLearner } from "../auth/auth.guard";
import { AnswerDto, AnswerResultDto, LessonDetailDto, LessonSummaryDto, StepReadDto } from "../dto";
import { LessonsService } from "./lessons.service";

@ApiTags("Lessons")
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller("lessons")
export class LessonsController {
  constructor(private readonly svc: LessonsService) {}

  @Get()
  @ApiOperation({ summary: "The learning path: every lesson with my own progress" })
  @ApiOkResponse({ type: [LessonSummaryDto] })
  list(@CurrentLearner() me: string) {
    return this.svc.list(me);
  }

  @Get(":slug")
  @ApiOperation({ summary: "One lesson: steps and questions with option texts only (no answer key)" })
  @ApiOkResponse({ type: LessonDetailDto })
  detail(@CurrentLearner() me: string, @Param("slug") slug: string) {
    return this.svc.detail(me, slug);
  }

  @Post(":slug/steps/:n/read")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark a step as read. Safe to repeat: it is stored once." })
  @ApiOkResponse({ type: StepReadDto })
  read(@CurrentLearner() me: string, @Param("slug") slug: string, @Param("n") n: string) {
    return this.svc.markRead(me, slug, n);
  }

  @Post(":slug/questions/:n/answer")
  @HttpCode(200)
  @ApiOperation({
    summary: "Answer a question and get a verdict with an explanation",
    description:
      "The reply says whether the chosen option is right and why. The index of the right option is sent only when the answer " +
      "was right, or after the second wrong answer to the same question. Every answer is recorded. Limited to 60 answers per minute per learner.",
  })
  @ApiOkResponse({ type: AnswerResultDto })
  answer(@CurrentLearner() me: string, @Param("slug") slug: string, @Param("n") n: string, @Body() dto: AnswerDto) {
    return this.svc.answer(me, slug, n, dto.option);
  }
}
