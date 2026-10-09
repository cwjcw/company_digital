import { Test } from "@nestjs/testing";
import { ForbiddenException, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { Readable } from "node:stream";
import { AuthGuard } from "../../auth";
import { OBJECT_STORAGE } from "../../storage/object-storage";
import { KnowledgeController } from "./knowledge.controller";
import { KnowledgeFilesService } from "./knowledge.files.service";
import { KnowledgePreviewService } from "./knowledge.preview.service";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { KnowledgeImportService } from "./knowledge.import.service";
import { KnowledgeExportService } from "./knowledge.export.service";
const fileId = "01926baa-1000-7000-8000-000000000001";
describe("private file HTTP transport", () => {
  let app: INestApplication;
  const queries = { attachment: jest.fn(), locations: jest.fn() },
    previews = { preview: jest.fn() },
    storage = { stat: jest.fn(), openStream: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeQueryService, useValue: queries },
        { provide: KnowledgePreviewService, useValue: previews },
        { provide: OBJECT_STORAGE, useValue: storage },
        ...[
          KnowledgeFilesService,
          KnowledgeApplicationService,
          KnowledgeImportService,
          KnowledgeExportService,
        ].map((provide) => ({ provide, useValue: {} })),
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          if (req.headers.authorization !== "Bearer fixture") return false;
          req.user = { sub: "fixture", username: "fixture" };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    queries.attachment.mockResolvedValue({
      key: "private",
      contentType: "application/pdf",
      originalName: "制度.pdf",
    });
    previews.preview.mockImplementation(queries.attachment);
    storage.stat.mockResolvedValue({ size: 10 });
    storage.openStream.mockImplementation((_key, range) =>
      Readable.from(
        Buffer.from("0123456789").subarray(
          range?.start ?? 0,
          range ? range.end + 1 : 10,
        ),
      ),
    );
  });
  it("location endpoint uses the Query Service and keeps authentication", async () => {
    queries.locations.mockResolvedValue({ rows: [], total: 0, page: 2, pageSize: 100 });
    const spaceId = "0199e000-0000-7000-8000-000000000002";
    await request(app.getHttpServer()).get(`/knowledge/spaces/${spaceId}/locations?page=2`).expect(403);
    const response = await request(app.getHttpServer()).get(`/knowledge/spaces/${spaceId}/locations?page=2`)
      .set("Authorization", "Bearer fixture").expect(200);
    expect(queries.locations).toHaveBeenCalledWith(spaceId, { page: "2" }, expect.any(Object));
    expect(response.body.page).toBe(2);
  });
  it("rejects unauthenticated Range before querying metadata or storage", async () => {
    await request(app.getHttpServer())
      .get(`/knowledge/files/${fileId}/preview`)
      .set("Range", "bytes=0-2")
      .expect(403);
    expect(queries.attachment).not.toHaveBeenCalled();
    expect(storage.stat).not.toHaveBeenCalled();
  });
  it("rechecks page authorization for every Range and exposes no storage metadata on denial", async () => {
    queries.attachment.mockRejectedValue(new ForbiddenException());
    for (const Range of ["bytes=0-2", "bytes=8-9"])
      await request(app.getHttpServer())
        .get(`/knowledge/files/${fileId}/original`)
        .set("Authorization", "Bearer fixture")
        .set("Range", Range)
        .expect(403);
    expect(queries.attachment).toHaveBeenCalledTimes(2);
    expect(storage.stat).not.toHaveBeenCalled();
  });
  it("streams 206 with a version-bound query and exact byte boundaries", async () => {
    const r = await request(app.getHttpServer())
      .get(`/knowledge/files/${fileId}/preview?mode=published&versionId=v1`)
      .set("Authorization", "Bearer fixture")
      .set("Range", "bytes=2-5")
      .expect(206);
    expect(r.headers["content-range"]).toBe("bytes 2-5/10");
    expect(r.headers["content-length"]).toBe("4");
    expect(Buffer.from(r.body).toString()).toBe("2345");
    expect(queries.attachment.mock.calls[0][1]).toEqual({
      mode: "published",
      versionId: "v1",
    });
    expect(r.headers["cache-control"]).toBe("private, no-store");
  });
  it("returns authorized 416 without opening the object", async () => {
    const r = await request(app.getHttpServer())
      .get(`/knowledge/files/${fileId}/original`)
      .set("Authorization", "Bearer fixture")
      .set("Range", "bytes=10-")
      .expect(416);
    expect(r.headers["content-range"]).toBe("bytes */10");
    expect(storage.openStream).not.toHaveBeenCalled();
  });
  it("HEAD remains authorized and never reads file content", async () => {
    await request(app.getHttpServer())
      .head(`/knowledge/files/${fileId}/original`)
      .set("Authorization", "Bearer fixture")
      .expect(200)
      .expect("Content-Length", "10");
    expect(queries.attachment).toHaveBeenCalledTimes(1);
    expect(storage.openStream).not.toHaveBeenCalled();
  });
});
