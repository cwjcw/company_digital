import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { SystemController } from "./controllers";

describe("System API (integration)", () => {
  let app: INestApplication;
  const originalBuildSha = process.env.KDOS_BUILD_SHA;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [SystemController] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });
  afterEach(() => {
    if (originalBuildSha === undefined) delete process.env.KDOS_BUILD_SHA;
    else process.env.KDOS_BUILD_SHA = originalBuildSha;
  });
  afterAll(() => app.close());

  it("reports a healthy API with an unknown fallback when build metadata is absent", async () => {
    delete process.env.KDOS_BUILD_SHA;
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.version).toEqual({ commit: "unknown", shortCommit: "unknown" });
  });

  it("reports the full and short build commit without changing health semantics", async () => {
    process.env.KDOS_BUILD_SHA = "ce1ed0adca0593c69ccd0263ccb12c8e399c205f";
    const response = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.version).toEqual({ commit: process.env.KDOS_BUILD_SHA, shortCommit: "ce1ed0a" });
  });
});
