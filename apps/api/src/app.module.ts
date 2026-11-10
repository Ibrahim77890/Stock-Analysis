import { DynamicModule, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth/auth.controller";
import { AuthGuard } from "./auth/auth.guard";
import { AuthService, LOGIN_LIMITER } from "./auth/auth.service";
import { APP_CONFIG, AppConfig } from "./config/app-config";
import { DbService } from "./db/db.service";
import { GlossaryController, GlossaryService } from "./glossary/glossary.controller";
import { LabController } from "./lab/lab.controller";
import { LabLimiters, LabService } from "./lab/lab.service";
import { LearningController } from "./learning/learning.controller";
import { LearningService } from "./learning/learning.service";
import { LessonsController } from "./lessons/lessons.controller";
import { LESSON_ANSWER_LIMITER, LessonsService } from "./lessons/lessons.service";
import { LimiterFactory } from "./limits/db-rate-limiter";
import { PythonClient } from "./python/python-client";
import { SystemController } from "./system/system.controller";
import { TraceMiddleware, TraceService } from "./trace/trace.service";

@Module({})
export class AppModule implements NestModule {
  static register(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [JwtModule.register({ secret: cfg.jwtSecret, signOptions: { expiresIn: "8h", algorithm: "HS256" } })],
      controllers: [AuthController, LearningController, LabController, LessonsController, GlossaryController, SystemController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        { provide: LOGIN_LIMITER, useFactory: (f: LimiterFactory) => f.make("login", cfg.loginLimit), inject: [LimiterFactory] },
        { provide: LESSON_ANSWER_LIMITER, useFactory: (f: LimiterFactory) => f.make("lesson-answer", 60), inject: [LimiterFactory] },
        { provide: LabLimiters, useFactory: (f: LimiterFactory) => new LabLimiters(f, cfg.labRunsPerMinute), inject: [LimiterFactory] },
        DbService, LimiterFactory, TraceService, LessonsService, PythonClient, AuthService, AuthGuard, LearningService, LabService, GlossaryService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes("*");
  }
}
