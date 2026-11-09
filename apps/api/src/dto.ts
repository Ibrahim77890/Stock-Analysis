import { ApiExtraModels, ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, MaxLength, Min, MinLength } from "class-validator";

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
