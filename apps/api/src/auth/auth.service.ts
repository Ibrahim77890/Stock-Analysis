import { ConflictException, HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DbService } from "../db/db.service";
import { LoginDto, RegisterDto, TokenDto } from "../dto";
import { dummyHash, hashPassword, verifyPassword } from "./password";

/** Simple in-memory limiter: at most `limit` attempts per window per key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

const TOO_MANY = "Too many tries. Please wait a minute and try again.";
const BAD_LOGIN = "That name or password is not right.";

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, private readonly jwt: JwtService, private readonly limiter: RateLimiter) {}

  private check(client: string, name: string): void {
    if (!this.limiter.allow(`${client}:${name.toLowerCase()}`)) throw new HttpException(TOO_MANY, 429);
  }

  async register(dto: RegisterDto, client: string): Promise<TokenDto> {
    this.check(client, dto.display_name);
    const hash = await hashPassword(dto.password);
    try {
      const r = await this.db.query(
        "INSERT INTO app.learner (display_name, display_name_key, password_hash) VALUES ($1, $2, $3) RETURNING learner_id, display_name",
        [dto.display_name, dto.display_name.toLowerCase(), hash],
      );
      return this.token(r.rows[0]);
    } catch (e: any) {
      if (e?.code === "23505") throw new ConflictException("That name is taken. Please choose another one.");
      throw e;
    }
  }

  async login(dto: LoginDto, client: string): Promise<TokenDto> {
    this.check(client, dto.display_name);
    const r = await this.db.query("SELECT learner_id, display_name, password_hash FROM app.learner WHERE display_name_key = $1", [dto.display_name.toLowerCase()]);
    const row = r.rows[0];
    const ok = await verifyPassword(dto.password, row ? row.password_hash : await dummyHash());
    if (!row || !ok) throw new UnauthorizedException(BAD_LOGIN); // same message and status for both cases
    await this.db.query("UPDATE app.learner SET last_login_at = now() WHERE learner_id = $1", [row.learner_id]);
    return this.token(row);
  }

  async me(learnerId: string) {
    const r = await this.db.query("SELECT learner_id, display_name FROM app.learner WHERE learner_id = $1", [learnerId]);
    if (!r.rows[0]) throw new UnauthorizedException("Please sign in again.");
    return r.rows[0];
  }

  private async token(row: { learner_id: string; display_name: string }): Promise<TokenDto> {
    const token = await this.jwt.signAsync({ sub: row.learner_id });
    return { token, learner: { learner_id: row.learner_id, display_name: row.display_name } };
  }
}
