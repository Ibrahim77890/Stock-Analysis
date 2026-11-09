import { ArgumentsHost, Catch, ExceptionFilter, HttpException, INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AppConfig, redact } from "./config/app-config";

/** One error shape for everything: { statusCode, message, request_id }. Unknown errors never leak details. */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("Errors");
  constructor(private readonly cfg: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    const requestId = res.getHeader?.("x-request-id");
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: any = exception.getResponse();
      let message: string | string[] = typeof body === "string" ? body : body?.message ?? exception.message;
      if (Array.isArray(message)) message = message[0];
      res.status(status).json({ statusCode: status, message, request_id: requestId });
      return;
    }
    this.log.error(redact(String((exception as any)?.stack ?? exception), this.cfg));
    res.status(500).json({ statusCode: 500, message: "Something went wrong on our side. Please try again.", request_id: requestId });
  }
}

export function swaggerDocument(app: INestApplication) {
  const options = new DocumentBuilder()
    .setTitle("MarketLab gateway")
    .setDescription(
      "The only API the web app talks to. NestJS handles accounts, who-owns-what, validation, the glossary and a request trace; " +
        "the Python service does every calculation. Charts are blind until you reveal an episode. For learning only; not investment advice.",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, options);
}

/** Builds the app the same way for production and for tests. */
export async function buildApp(cfg: AppConfig, configure?: (builder: any) => any): Promise<INestApplication> {
  const { Test } = configure ? await import("@nestjs/testing") : ({} as any);
  let app: INestApplication;
  if (configure) {
    const builder = Test.createTestingModule({ imports: [AppModule.register(cfg)] });
    const moduleRef = await configure(builder).compile();
    app = moduleRef.createNestApplication();
  } else {
    app = await NestFactory.create(AppModule.register(cfg), { logger: ["error", "warn", "log"] });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, errorHttpStatusCode: 422 }));
  app.useGlobalFilters(new SafeExceptionFilter(cfg));
  app.enableCors({ origin: cfg.corsOrigins, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"], credentials: false });
  SwaggerModule.setup("docs", app, swaggerDocument(app));
  return app;
}
