import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LearnerDto, LoginDto, RegisterDto, TokenDto } from "../dto";
import { AuthGuard, CurrentLearner } from "./auth.guard";
import { AuthService } from "./auth.service";

@ApiTags("Account")
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("auth/register")
  @HttpCode(200)
  @ApiOperation({ summary: "Create a learner account on this machine" })
  @ApiOkResponse({ type: TokenDto })
  register(@Body() dto: RegisterDto, @Req() req: any): Promise<TokenDto> {
    return this.auth.register(dto, req.ip ?? "local");
  }

  @Post("auth/login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in; returns a bearer token (8 hours)" })
  @ApiOkResponse({ type: TokenDto })
  login(@Body() dto: LoginDto, @Req() req: any): Promise<TokenDto> {
    return this.auth.login(dto, req.ip ?? "local");
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Who am I?" })
  @ApiOkResponse({ type: LearnerDto })
  me(@CurrentLearner() learnerId: string): Promise<LearnerDto> {
    return this.auth.me(learnerId);
  }
}
