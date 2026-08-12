import "reflect-metadata";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { static as serveStatic } from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(",") ?? ["http://localhost:5173"], credentials: true });
  app.use("/uploads", serveStatic(path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? "./data/uploads")));
  app.use((request: any, response: any, next: () => void) => {
    request.requestId = request.headers["x-request-id"] || randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  app.setGlobalPrefix("api/v1", { exclude: ["api/docs", "api/openapi.json"] });
  const config = new DocumentBuilder()
    .setTitle("四部追踪表 API").setDescription("生产主计划、月度计划、基础资料与导入导出")
    .setVersion("0.1").addBearerAuth().build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);
  app.getHttpAdapter().get("/api/openapi.json", (_req: unknown, res: any) => res.json(document));
  await app.listen(Number(process.env.API_PORT ?? 3000), "0.0.0.0");
}
void bootstrap();
