import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { TraceService } from "../trace/trace.service";

const PLEASE = "Please sign in to continue.";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly trace: TraceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers["authorization"];
    if (!header || !header.startsWith("Bearer ")) throw new UnauthorizedException(PLEASE);
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7), { algorithms: ["HS256"] });
      if (!payload.sub) throw new Error("no subject");
      req.learnerId = payload.sub;
      this.trace.setLearner(payload.sub);
      return true;
    } catch {
      throw new UnauthorizedException(PLEASE);
    }
  }
}

export const CurrentLearner = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().learnerId);
