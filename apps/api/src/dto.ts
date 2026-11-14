import { ApiExtraModels, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { Equals, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

// ------------------------------------------------------------------ requests

export class RegisterDto {
  @ApiProperty({ example: "Sam", description: "2 to 40 characters" })
  @Transform(trim)
  @IsString({ message: "Please type a name." })
  @Length(2, 40, { message: "Your name needs 2 to 40 characters." })
  display_name!: string;

  @ApiProperty({ example: "three random words here", description: "10 to 128 characters" })
  @IsString({ message: "Please type a password." })
  @MinLength(10, { message: "Your password needs at least 10 characters. A few random words is fine." })
  @MaxLength(128, { message: "Your password can have at most 128 characters." })
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: "Sam" })
  @Transform(trim)
  @IsString({ message: "Please type your name." })
  @Length(1, 40, { message: "Please type your name." })
  display_name!: string;

  @ApiProperty()
  @IsString({ message: "Please type your password." })
  @MaxLength(128, { message: "That password is too long." })
  password!: string;
}

export class CreateEpisodeDto {
  @ApiPropertyOptional({ enum: ["mixed", "real", "synthetic"], default: "mixed", description: "mixed hides whether the series is real or made up until the reveal" })
  @IsOptional()
  @IsIn(["mixed", "real", "synthetic"], { message: "Choose real, made-up or mixed." })
  kind?: "mixed" | "real" | "synthetic" = "mixed";

  @ApiPropertyOptional({ default: 250, minimum: 60, maximum: 500 })
  @IsOptional()
  @IsInt({ message: "The length must be a whole number." })
  @Min(60, { message: "An episode needs at least 60 days." })
  @Max(500, { message: "An episode can have at most 500 days." })
  n_bars?: number = 250;

  @ApiPropertyOptional({ default: 60, minimum: 20, maximum: 499, description: "days you can see at the start" })
  @IsOptional()
  @IsInt()
  @Min(20, { message: "You need to see at least 20 days at the start." })
  @Max(499)
  initial_visible?: number = 60;

  @ApiPropertyOptional({ description: "optional: the same seed rebuilds the same episode" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  seed?: number;
}

export class AdvanceDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 20 })
  @IsOptional()
  @IsInt({ message: "Days must be a whole number." })
  @Min(1, { message: "Move forward at least 1 day." })
  @Max(20, { message: "Move forward at most 20 days at a time." })
  n?: number = 1;
}

export class PredictionDto {
  @ApiProperty({ enum: [1, 5, 10], description: "how many days ahead" })
  @IsIn([1, 5, 10], { message: "Choose 1, 5 or 10 days ahead." })
  horizon!: 1 | 5 | 10;

  @ApiProperty({ minimum: 0.01, maximum: 0.99, example: 0.7, description: "chance that the price is higher then (0.01 to 0.99, at most 4 decimals)" })
  @IsNumber({ maxDecimalPlaces: 4 }, { message: "Use at most 4 decimals." })
  @Min(0.01, { message: "Choose between 1% and 99%." })
  @Max(0.99, { message: "Choose between 1% and 99%." })
  p_up!: number;
}

// ------------------------------------------------------------------ responses

export class LearnerDto {
  @ApiProperty() learner_id!: string;
  @ApiProperty() display_name!: string;
}

export class TokenDto {
  @ApiProperty() token!: string;
  @ApiProperty({ type: LearnerDto }) learner!: LearnerDto;
}

export class HealthDto {
  @ApiProperty() status!: string;
  @ApiProperty({ enum: ["ok"] }) gateway!: string;
  @ApiProperty({ enum: ["ok", "down"] }) database!: string;
  @ApiProperty({ enum: ["ok", "down"] }) python!: string;
}

export class EpisodeStateDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty() n_bars!: number;
  @ApiProperty() initial_visible!: number;
  @ApiProperty({ description: "the current day (cursor)" }) day!: number;
  @ApiProperty({ enum: ["open", "revealed"] }) status!: string;
  @ApiProperty({ enum: ["mixed", "real", "synthetic"] }) kind_requested!: string;
  @ApiPropertyOptional({ enum: ["real", "synthetic"], description: "present only when you asked for a specific kind, or after the reveal" }) kind?: string;
}

export class EpisodeListItemDto extends EpisodeStateDto {
  @ApiProperty() created_at!: string;
}

export class BarDto {
  @ApiProperty() day!: number;
  @ApiProperty() open!: number;
  @ApiProperty() high!: number;
  @ApiProperty() low!: number;
  @ApiProperty() close!: number;
  @ApiProperty({ description: "volume divided by the mean volume of the first visible days" }) rel_volume!: number;
}

export class BarsDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty({ type: [BarDto] }) bars!: BarDto[];
}

export class CountsDto {
  @ApiProperty() resolved!: number;
  @ApiProperty() void!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() total!: number;
}

export class PredictionItemDto {
  @ApiProperty() prediction_id!: number;
  @ApiProperty({ description: "the day it was made" }) day!: number;
  @ApiProperty({ enum: [1, 5, 10] }) horizon!: number;
  @ApiProperty() p_up!: number;
  @ApiProperty({ enum: ["pending", "resolved", "void"] }) status!: string;
  @ApiProperty({ type: Number, nullable: true, description: "1 if the price went up, 0 if not; null until answered" }) outcome!: number | null;
  @ApiPropertyOptional({ description: "false when this exact guess already existed" }) created?: boolean;
}

export class PredictionsDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty({ type: [PredictionItemDto] }) predictions!: PredictionItemDto[];
  @ApiProperty({ type: CountsDto }) counts!: CountsDto;
}

export class BinDto {
  @ApiProperty() bin_low!: number;
  @ApiProperty() bin_high!: number;
  @ApiProperty() n!: number;
  @ApiProperty({ type: Number, nullable: true }) mean_forecast!: number | null;
  @ApiProperty({ type: Number, nullable: true }) observed!: number | null;
  @ApiProperty({ type: Number, nullable: true }) wilson_low!: number | null;
  @ApiProperty({ type: Number, nullable: true }) wilson_high!: number | null;
  @ApiProperty() sparse!: boolean;
}

export class LuckDto {
  @ApiProperty({ type: Number, nullable: true }) real_brier!: number | null;
  @ApiProperty({ type: Number, nullable: true }) luck_probability!: number | null;
  @ApiProperty() n_perm!: number;
  @ApiProperty() seed!: number;
  @ApiProperty() count!: number;
  @ApiProperty({ description: "true while there are too few answered guesses to report it" }) not_reported!: boolean;
  @ApiProperty({ type: "object", additionalProperties: { type: "number" }, nullable: true }) shuffled_quantiles!: Record<string, number> | null;
}

export class ScoreDto {
  @ApiPropertyOptional() episode_id?: string;
  @ApiPropertyOptional({ type: CountsDto }) counts?: CountsDto;
  @ApiProperty() n!: number;
  @ApiProperty({ type: Number, nullable: true, description: "Brier score; lower is better; 0.25 is a coin flip" }) brier!: number | null;
  @ApiProperty({ type: Number, nullable: true }) skill_vs_coin_flip!: number | null;
  @ApiProperty({ type: Number, nullable: true }) log_loss!: number | null;
  @ApiProperty({ type: [BinDto] }) bins!: BinDto[];
  @ApiProperty({ type: "object", additionalProperties: true }) murphy!: Record<string, unknown>;
  @ApiProperty({ type: "object", additionalProperties: true }) baselines!: Record<string, unknown>;
  @ApiProperty({ type: LuckDto }) luck!: LuckDto;
  @ApiProperty() enough!: boolean;
  @ApiProperty() min_enough!: number;
  @ApiProperty({ type: [String] }) warnings!: string[];
}

export class IdentityDto {
  @ApiProperty() symbol!: string;
  @ApiProperty() name!: string;
  @ApiProperty() asset_type!: string;
  @ApiProperty({ type: String, nullable: true }) sector!: string | null;
  @ApiProperty() first_date!: string;
  @ApiProperty() last_date!: string;
  @ApiProperty() source!: string;
}

export class DataTrailDto {
  @ApiProperty() provider!: string;
  @ApiProperty({ type: String, nullable: true }) retrieved_at!: string | null;
  @ApiProperty() feed_caveat!: string;
  @ApiProperty() universe_caveat!: string;
  @ApiProperty() adjustment!: string;
  @ApiProperty() stored_adjustment!: string;
  @ApiProperty({ type: Boolean, nullable: true }) file_hash_matches!: boolean | null;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty() licence!: string;
}

export class RevealDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty({ enum: ["real", "synthetic"] }) kind!: string;
  @ApiProperty() seed!: number;
  @ApiProperty({ type: CountsDto }) counts!: CountsDto;
  @ApiPropertyOptional() synthetic_volatility?: number;
  @ApiPropertyOptional() statement?: string;
  @ApiPropertyOptional({ type: IdentityDto }) identity?: IdentityDto;
  @ApiPropertyOptional({ type: DataTrailDto }) data_trail?: DataTrailDto;
}

export class OverallDto {
  @ApiProperty() n!: number;
  @ApiProperty({ type: Number, nullable: true }) brier!: number | null;
  @ApiProperty({ type: Number, nullable: true }) skill_vs_coin_flip!: number | null;
  @ApiProperty({ type: Number, nullable: true }) log_loss!: number | null;
  @ApiProperty() enough!: boolean;
  @ApiProperty() min_enough!: number;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: "object", additionalProperties: true }) baselines!: Record<string, unknown>;
  @ApiProperty({ type: LuckDto }) luck!: LuckDto;
}

export class KindScoreDto {
  @ApiProperty() n!: number;
  @ApiProperty({ type: Number, nullable: true }) brier!: number | null;
}

@ApiExtraModels(KindScoreDto)
export class ProgressDto {
  @ApiProperty({ type: OverallDto }) overall!: OverallDto;
  @ApiProperty({ type: "object", additionalProperties: { $ref: "#/components/schemas/KindScoreDto" }, description: "revealed episodes only: keys real and synthetic" }) by_kind!: Record<string, KindScoreDto>;
  @ApiProperty({ type: "object", additionalProperties: { $ref: "#/components/schemas/KindScoreDto" }, description: "keys 1, 5 and 10" }) by_horizon!: Record<string, KindScoreDto>;
  @ApiProperty() episodes!: number;
}

export class GlossaryTermDto {
  @ApiProperty() slug!: string;
  @ApiProperty() term!: string;
  @ApiProperty() plain_definition!: string;
  @ApiProperty({ type: String, nullable: true }) example!: string | null;
  @ApiProperty() level!: string;
  @ApiProperty() category!: string;
  @ApiProperty({ type: [String] }) related!: string[];
  @ApiProperty() source!: string;
}

export class UpstreamEntryDto {
  @ApiProperty({ enum: ["python"] }) service!: string;
  @ApiProperty() route!: string;
  @ApiProperty() status!: number;
  @ApiProperty() duration_ms!: number;
}

export class TraceEntryDto {
  @ApiProperty() request_id!: string;
  @ApiProperty() time!: string;
  @ApiProperty() method!: string;
  @ApiProperty() route!: string;
  @ApiProperty() status!: number;
  @ApiProperty() duration_ms!: number;
  @ApiProperty({ type: [UpstreamEntryDto] }) upstream!: UpstreamEntryDto[];
}

export class OwnershipDto {
  @ApiProperty() schema!: string;
  @ApiProperty() owner!: string;
  @ApiProperty() holds!: string;
}

export class SystemDto {
  @ApiProperty({ type: HealthDto }) health!: HealthDto;
  @ApiProperty({ type: String, nullable: true }) app_migration!: string | null;
  @ApiProperty({ type: String, nullable: true }) python_migration!: string | null;
  @ApiProperty({ type: [OwnershipDto] }) ownership!: OwnershipDto[];
  @ApiProperty() checked_at!: string;
}

// ------------------------------------------------------------------ Strategy Lab (Sprint 07)

export class CreateStudyDto {
  @ApiProperty({ example: "AAPL", description: "a stock from GET /lab/stocks" })
  @Transform(trim)
  @IsString({ message: "Please choose a stock." })
  @Matches(/^[A-Za-z0-9.\-]{1,12}$/, { message: "That is not a valid stock symbol." })
  symbol!: string;

  @ApiPropertyOptional({ example: "My first idea", description: "optional label, up to 80 characters" })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: "The label must be text." })
  @MaxLength(80, { message: "The label can have at most 80 characters." })
  name?: string;
}

export class RunDto {
  @ApiProperty({ minimum: 2, maximum: 299, example: 20, description: "short average, in trading days" })
  @IsInt({ message: "The short average must be a whole number of days." })
  @Min(2, { message: "The short average needs at least 2 days." })
  @Max(299, { message: "The short average can be at most 299 days." })
  fast!: number;

  @ApiProperty({ minimum: 3, maximum: 300, example: 100, description: "long average, in trading days; longer than the short one" })
  @IsInt({ message: "The long average must be a whole number of days." })
  @Min(3, { message: "The long average needs at least 3 days." })
  @Max(300, { message: "The long average can be at most 300 days." })
  slow!: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 50, default: 2, description: "cost per trade in basis points (1 basis point = 0.01%)" })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "Use at most 2 decimals for the cost." })
  @Min(0, { message: "The cost cannot be below 0." })
  @Max(50, { message: "The cost can be at most 50 basis points." })
  cost_bps?: number = 2;

  @ApiPropertyOptional({ minimum: 0, maximum: 2147483647, default: 1, description: "the same seed gives the same luck check" })
  @IsOptional()
  @IsInt({ message: "The seed must be a whole number." })
  @Min(0)
  @Max(2147483647)
  seed?: number = 1;

  @ApiPropertyOptional({ minimum: 10, maximum: 200, default: 100, description: "how many mixed-up histories the luck check uses" })
  @IsOptional()
  @IsInt({ message: "The number of mixed-up histories must be a whole number." })
  @Min(10, { message: "Use at least 10 mixed-up histories." })
  @Max(200, { message: "Use at most 200 mixed-up histories." })
  n_paths?: number = 100;
}

export class VaultDto {
  @ApiProperty({ minimum: 2, maximum: 299 })
  @IsInt() @Min(2) @Max(299)
  fast!: number;

  @ApiProperty({ minimum: 3, maximum: 300 })
  @IsInt() @Min(3) @Max(300)
  slow!: number;

  @ApiProperty({ minimum: 0, maximum: 50, description: "the same cost you used when you ran this rule on the practice years" })
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50)
  cost_bps!: number;

  @ApiProperty({ enum: [true], description: "must be true: opening the vault cannot be undone" })
  @Equals(true, { message: "Please confirm that you want to open the vault. It can be opened only once." })
  confirm!: boolean;
}

export class StockDto {
  @ApiProperty() symbol!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) sector!: string | null;
  @ApiProperty() first_date!: string;
  @ApiProperty() bars!: number;
  @ApiProperty() years!: number;
}

export class StocksDto {
  @ApiProperty({ type: [StockDto] }) stocks!: StockDto[];
}

export class StudyCardDto {
  @ApiProperty() study_id!: number;
  @ApiProperty() symbol!: string;
  @ApiProperty() name!: string;
  @ApiProperty() practice_years!: number;
  @ApiProperty() vault_years!: number;
  @ApiProperty() vault_open!: boolean;
  @ApiProperty() ideas_tried!: number;
}

export class StudyListItemDto extends StudyCardDto {
  @ApiProperty() created_at!: string;
}

export class StudyCreatedDto {
  @ApiProperty() study_id!: number;
  @ApiProperty() symbol!: string;
  @ApiProperty() name!: string;
  @ApiProperty() practice_bars!: number;
  @ApiProperty() practice_years!: number;
  @ApiProperty() vault_bars!: number;
  @ApiProperty() vault_years!: number;
  @ApiProperty() vault_open!: boolean;
}

export class TrialDto {
  @ApiProperty() order!: number;
  @ApiProperty() fast!: number;
  @ApiProperty() slow!: number;
  @ApiProperty() cost_bps!: number;
  @ApiProperty({ type: Number, nullable: true }) total_return!: number | null;
  @ApiProperty({ type: Number, nullable: true }) sharpe!: number | null;
  @ApiProperty({ type: Number, nullable: true }) trades!: number | null;
}

export class StudyOverviewDto {
  @ApiProperty() study_id!: number;
  @ApiProperty() symbol!: string;
  @ApiProperty() name!: string;
  @ApiProperty() practice_years!: number;
  @ApiProperty() practice_bars!: number;
  @ApiProperty() vault_years!: number;
  @ApiProperty() vault_bars!: number;
  @ApiProperty() vault_open!: boolean;
  @ApiProperty() ideas_tried!: number;
  @ApiProperty({ type: [TrialDto] }) trials!: TrialDto[];
}

export class LabMetricsDto {
  @ApiProperty({ type: Number, nullable: true, description: "0.25 means up 25%" }) total_return!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: "per year, compounded" }) cagr!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: "largest fall from a peak, negative" }) max_drawdown!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: "share of days invested" }) exposure!: number | null;
  @ApiProperty() trades!: number;
  @ApiProperty({ type: Number, nullable: true }) sharpe!: number | null;
}

export class GrowthDto {
  @ApiProperty({ type: [String], description: "at most 300 points; first and last day always kept" }) dates!: string[];
  @ApiProperty({ type: [Number], description: "growth of 100 for the rule" }) rule!: number[];
  @ApiProperty({ type: [Number], description: "growth of 100 for buy and hold" }) buy_hold!: number[];
}

export class YearlyDto {
  @ApiProperty() year!: number;
  @ApiProperty() rule!: number;
  @ApiProperty() buy_hold!: number;
}

export class CostRowDto {
  @ApiProperty() cost_bps!: number;
  @ApiProperty({ type: Number, nullable: true }) total_return!: number | null;
  @ApiProperty({ type: Number, nullable: true }) sharpe!: number | null;
  @ApiProperty() trades!: number;
  @ApiProperty({ type: Number, nullable: true }) buy_hold_total_return!: number | null;
}

export class LabLuckDto {
  @ApiProperty() method!: string;
  @ApiProperty() n_paths!: number;
  @ApiProperty() seed!: number;
  @ApiProperty({ type: Number, nullable: true }) real_total_return!: number | null;
  @ApiProperty({ type: Number, nullable: true }) percentile_rank!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: "share of mixed-up histories that did as well or better" }) fraction_as_good!: number | null;
  @ApiProperty({ type: Number, nullable: true }) median!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p5!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p95!: number | null;
  @ApiProperty() note!: string;
}

export class OverfitMeterDto {
  @ApiProperty() trials!: number;
  @ApiProperty({ type: Number, nullable: true }) best_sharpe!: number | null;
  @ApiProperty({ type: Number, nullable: true }) expected_best_sharpe_by_luck!: number | null;
  @ApiProperty({ type: Number, nullable: true }) dsr!: number | null;
  @ApiProperty() note!: string;
}

export class RunParamsDto {
  @ApiProperty() fast!: number;
  @ApiProperty() slow!: number;
  @ApiProperty() cost_bps!: number;
  @ApiProperty() seed!: number;
  @ApiProperty() n_paths!: number;
}

export class LabRunDto {
  @ApiProperty() study_id!: number;
  @ApiProperty() symbol!: string;
  @ApiProperty({ description: "false when the same rule and cost had already been run: it is recomputed, not counted again" }) counted!: boolean;
  @ApiProperty({ description: "ideas tried so far in this study" }) trial_count!: number;
  @ApiProperty({ type: RunParamsDto }) params!: RunParamsDto;
  @ApiProperty() practice_years!: number;
  @ApiProperty() practice_bars!: number;
  @ApiProperty({ type: LabMetricsDto }) rule!: LabMetricsDto;
  @ApiProperty({ type: LabMetricsDto }) buy_hold!: LabMetricsDto;
  @ApiProperty({ type: GrowthDto }) growth!: GrowthDto;
  @ApiProperty({ type: [YearlyDto] }) yearly!: YearlyDto[];
  @ApiProperty({ type: [CostRowDto] }) costs!: CostRowDto[];
  @ApiProperty({ type: LabLuckDto }) luck!: LabLuckDto;
  @ApiPropertyOptional({ type: OverfitMeterDto, description: "present from the second idea tried" }) overfitting_meter?: OverfitMeterDto;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty() config_hash!: string;
}

export class VaultParamsDto {
  @ApiProperty() fast!: number;
  @ApiProperty() slow!: number;
  @ApiProperty() cost_bps!: number;
}

export class VaultPracticeDto {
  @ApiProperty({ type: LabMetricsDto, description: "the same rule on the practice years" }) rule!: LabMetricsDto;
  @ApiProperty({ type: LabMetricsDto, description: "buy and hold on the practice years" }) buy_hold!: LabMetricsDto;
  @ApiProperty() years!: number;
}

export class VaultResultDto {
  @ApiProperty() study_id!: number;
  @ApiProperty({ type: VaultParamsDto }) params!: VaultParamsDto;
  @ApiProperty({ type: LabMetricsDto }) rule!: LabMetricsDto;
  @ApiProperty({ type: LabMetricsDto }) buy_hold!: LabMetricsDto;
  @ApiProperty({ type: GrowthDto }) growth!: GrowthDto;
  @ApiProperty({ type: [YearlyDto] }) yearly!: YearlyDto[];
  @ApiProperty() vault_years!: number;
  @ApiProperty() vault_bars!: number;
  @ApiProperty({ type: VaultPracticeDto }) practice!: VaultPracticeDto;
  @ApiProperty({ description: "ideas tried in this study when the vault was opened" }) ideas_tried!: number;
}

// ------------------------------------------------------------------ lessons
// Naming note: replies that carry lesson text never use the words "correct" or "why" as field names,
// so a scan for the answer key can look for them without false alarms. Only the answer reply has them.

export class LessonSummaryDto {
  @ApiProperty({ example: "brier-score" }) slug!: string;
  @ApiProperty() position!: number;
  @ApiProperty() version!: number;
  @ApiProperty() title!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() minutes!: number;
  @ApiProperty() steps_total!: number;
  @ApiProperty({ description: "Steps this learner has read" }) steps_read!: number;
  @ApiProperty() questions_total!: number;
  @ApiProperty({ description: "Questions this learner has answered rightly at least once" }) questions_right!: number;
  @ApiProperty({ description: "Marked complete by the learner, or all steps read and all questions answered rightly" }) done!: boolean;
  @ApiProperty({ description: "This lesson's own setting: may a learner mark it complete by hand?" }) manual_complete_allowed!: boolean;
  @ApiProperty({ description: "The learner marked this lesson complete by hand" }) completed_manually!: boolean;
}

export class LessonStepDto {
  @ApiProperty() head!: string;
  @ApiProperty({ description: "May hold {{slug|label}} glossary markers" }) body!: string;
  @ApiPropertyOptional() more?: string;
  @ApiPropertyOptional({ enum: ["chance-70", "coin-streaks", "many-tries"] }) demo?: string;
  @ApiPropertyOptional({ description: "A diagram or worked calculation shown with the step" }) visual?: string;
}

export class LessonQuestionDto {
  @ApiProperty({ description: "1-based" }) position!: number;
  @ApiProperty() prompt!: string;
  @ApiProperty({ type: [String], description: "Option texts only. The answer key stays on the server." }) options!: string[];
  @ApiProperty({ description: "Has this learner answered it rightly at least once?" }) answered_right!: boolean;
  @ApiProperty({ description: "How many times this learner has answered it" }) attempts!: number;
}

export class LessonDetailDto extends LessonSummaryDto {
  @ApiProperty({ type: [LessonStepDto] }) steps!: LessonStepDto[];
  @ApiProperty({ type: [LessonQuestionDto] }) questions!: LessonQuestionDto[];
  @ApiProperty({ type: [Number], description: "1-based numbers of the steps this learner has read" }) steps_read_list!: number[];
}

export class CompletionDto {
  @ApiProperty() lesson_slug!: string;
  @ApiProperty() completed_manually!: boolean;
  @ApiProperty() done!: boolean;
}

export class StepReadDto {
  @ApiProperty() lesson_slug!: string;
  @ApiProperty() step!: number;
  @ApiProperty({ description: "Steps read so far in this lesson" }) steps_read!: number;
  @ApiProperty() steps_total!: number;
}

export class AnswerDto {
  @ApiProperty({ example: 0, description: "0-based index of the chosen option" })
  @IsInt({ message: "Please choose one of the options." })
  @Min(0, { message: "Please choose one of the options." })
  @Max(3, { message: "Please choose one of the options." })
  option!: number;
}

export class AnswerResultDto {
  @ApiProperty() correct!: boolean;
  @ApiProperty({ description: "The explanation for the option that was chosen" }) why!: string;
  @ApiPropertyOptional({
    description: "Index of the right option. Sent only when the answer was right, or after the second wrong answer to this question.",
  })
  correct_option?: number;
  @ApiProperty({ description: "Wrong answers so far to this question" }) wrong_so_far!: number;
  @ApiProperty({ description: "Rightly answered at least once" }) answered_right!: boolean;
}

// ------------------------------------------------------------------ indicators and practice decisions (Sprint 09)

export class IndicatorPointDto {
  @ApiProperty({ description: "Episode day number (1-based)" }) day!: number;
  @ApiProperty() value!: number;
}

export class IndicatorDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty({ enum: ["sma", "ema", "rsi"] }) name!: string;
  @ApiProperty() window!: number;
  @ApiProperty({ description: "Days revealed so far. Values exist only for these days." }) day!: number;
  @ApiProperty({ type: [IndicatorPointDto], description: "Warm-up days have no value and are left out" }) values!: IndicatorPointDto[];
}

export class DecisionInDto {
  @ApiProperty({ enum: ["long", "flat"], description: "long = hold from the close of today; flat = hold nothing. A practice stance, not advice." })
  @IsIn(["long", "flat"], { message: "Please choose long or flat." })
  stance!: "long" | "flat";

  @ApiProperty({ example: "The price has stayed above its average.", description: "1 to 280 characters, written before the result is known" })
  @Transform(trim)
  @IsString({ message: "Please write a short reason." })
  @Length(1, 280, { message: "Your reason needs 1 to 280 characters." })
  reason!: string;

  @ApiProperty({ example: "5b1f0c1a-0000-4000-8000-000000000000", description: "The same key twice stores one decision (a double click is safe)" })
  @IsString({ message: "Something went wrong. Please try again." })
  @Length(8, 64, { message: "Something went wrong. Please try again." })
  client_key!: string;

  @ApiPropertyOptional({ example: 2, description: "Cost of changing stance in basis points, 0 to 50" })
  @IsOptional()
  @IsNumber({}, { message: "The cost must be a number from 0 to 50." })
  @Min(0, { message: "The cost must be a number from 0 to 50." })
  @Max(50, { message: "The cost must be a number from 0 to 50." })
  cost_bps?: number;
}

export class DecisionDto {
  @ApiProperty() decision_id!: number;
  @ApiProperty() day!: number;
  @ApiProperty({ enum: ["long", "flat"] }) stance!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() cost_bps!: number;
  @ApiProperty({ description: "Days of results marked so far" }) days_marked!: number;
  @ApiProperty({ enum: ["pending", "marked"] }) status!: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: "Fractional result after cost; null while pending" }) result?: number | null;
  @ApiPropertyOptional({ description: "Only in the reply to a new decision: false when the same key was already stored" }) created?: boolean;
}

export class JournalTotalsDto {
  @ApiProperty() decisions!: number;
  @ApiProperty() marked!: number;
  @ApiProperty() pending!: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) growth?: number | null;
  @ApiProperty() note!: string;
}

export class JournalDto {
  @ApiProperty() episode_id!: string;
  @ApiProperty() day!: number;
  @ApiProperty({ type: [DecisionDto] }) decisions!: DecisionDto[];
  @ApiProperty({ type: JournalTotalsDto }) totals!: JournalTotalsDto;
}

// ------------------------------------------------------------------ operations and data status (Sprint 10)

export class MetricRouteDto {
  @ApiProperty({ example: "GET /lessons/:slug" }) route!: string;
  @ApiProperty() count!: number;
  @ApiProperty({ description: "Answers with status 400 to 499" }) client_errors!: number;
  @ApiProperty({ description: "Answers with status 500 or more" }) server_errors!: number;
  @ApiProperty({ type: Number, nullable: true }) p50_ms!: number | null;
  @ApiProperty({ type: Number, nullable: true }) p95_ms!: number | null;
  @ApiProperty({ type: Number, nullable: true }) max_ms!: number | null;
}

export class ServiceMetricsDto {
  @ApiProperty({ enum: ["gateway", "python"] }) service!: string;
  @ApiPropertyOptional() uptime_seconds?: number;
  @ApiPropertyOptional() note?: string;
  @ApiProperty({ type: [MetricRouteDto] }) routes!: MetricRouteDto[];
}

export class MetricsDto {
  @ApiProperty() window_hours!: number;
  @ApiProperty({ type: ServiceMetricsDto }) gateway!: ServiceMetricsDto;
  @ApiPropertyOptional({ type: ServiceMetricsDto, description: "Absent when the Python service could not be asked" }) python?: ServiceMetricsDto;
}

export class DataSourceDto {
  @ApiProperty({ example: "tiingo" }) source!: string;
  @ApiProperty() symbols!: number;
  @ApiProperty() symbols_with_long_history!: number;
  @ApiProperty() bars!: number;
  @ApiProperty({ example: "2005-01-03" }) first_date!: string;
  @ApiProperty({ example: "2025-12-31" }) last_date!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) retrieved_at?: string | null;
}

export class QualitySummaryDto {
  @ApiProperty({ description: "Has a quality run been stored at all?" }) run!: boolean;
  @ApiProperty() rules_flagged!: number;
  @ApiProperty() errors!: number;
  @ApiProperty() warnings!: number;
  @ApiProperty() infos!: number;
}

export class MacroSummaryDto {
  @ApiProperty() series!: number;
  @ApiProperty() observations!: number;
  @ApiPropertyOptional({ type: String, nullable: true }) first_date?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) last_date?: string | null;
}

export class DataStatusDto {
  @ApiProperty({ type: [DataSourceDto] }) sources!: DataSourceDto[];
  @ApiProperty({ description: "A symbol counts as long history with at least this many sessions" }) min_sessions_for_long_history!: number;
  @ApiProperty({ type: QualitySummaryDto }) quality!: QualitySummaryDto;
  @ApiProperty({ type: MacroSummaryDto }) macro!: MacroSummaryDto;
  @ApiProperty({ type: [String], description: "Always shown: survivorship bias, one vendor, licence, not advice" }) caveats!: string[];
  @ApiProperty({ description: "True when no price data is loaded" }) empty!: boolean;
}
