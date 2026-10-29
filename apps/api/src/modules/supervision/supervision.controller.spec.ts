import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
jest.mock("../../auth", () => ({ AuthGuard: class AuthGuard {} }));
jest.mock("./supervision.scope", () => ({ hasSupervisionPermission: () => true }));
jest.mock("./supervision.application.service", () => ({ SupervisionApplicationService: class SupervisionApplicationService {} }));
jest.mock("./supervision.query.service", () => ({ SupervisionQueryService: class SupervisionQueryService {} }));
import { LocalObjectStorage } from "../../storage/local-object-storage";
import { SupervisionController } from "./supervision.controller";

describe("Supervision attachment upload keys", () => {
  let directory: string;
  let previousUploadDir: string | undefined;
  let storage: LocalObjectStorage;
  let application: { recordAttachmentUpload: jest.Mock };
  let queries: { attachment: jest.Mock };
  let controller: SupervisionController;
  const request = {
    user: { sub: "test-user", username: "test-user", permissions: ["supervision-tasks:*:create"] },
    requestId: "attachment-test",
  } as any;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "kdos-supervision-attachments-"));
    previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = directory;
    storage = new LocalObjectStorage();
    application = { recordAttachmentUpload: jest.fn().mockResolvedValue(undefined) };
    queries = { attachment: jest.fn() };
    controller = new SupervisionController(application as any, queries as any, storage);
  });

  afterEach(async () => {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each([
    "任务附件测试.xlsx",
    "验收 报告（终版）.pdf",
    "task_attachment.xlsx",
    "测试#1 (final).xlsx",
  ])("stores %s using a safe key while preserving the display filename", async (originalname) => {
    const body = Buffer.from("attachment test content");
    const attachment = await controller.uploadAttachment({
      originalname,
      buffer: body,
      mimetype: "application/octet-stream",
      size: body.length,
    } as Express.Multer.File, request);

    expect(attachment.name).toBe(originalname);
    expect(attachment.key).toMatch(/^supervision\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/);
    expect([...attachment.key].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(await storage.get(attachment.key)).toMatchObject({ body });
    expect(application.recordAttachmentUpload).toHaveBeenCalledWith(attachment, expect.objectContaining({ tenantId: expect.any(String) }));
  });

  it("downloads the uploaded Chinese filename using RFC 5987 Content-Disposition", async () => {
    const originalname = "任务附件测试.xlsx";
    const attachment = await controller.uploadAttachment({
      originalname,
      buffer: Buffer.from("xlsx bytes"),
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 10,
    } as Express.Multer.File, request);
    queries.attachment.mockResolvedValue(attachment);
    const response = { setHeader: jest.fn(), send: jest.fn() } as any;

    await controller.downloadAttachment("tasks", "task-id", "0", request, response);

    expect(response.setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment; filename*=UTF-8''%E4%BB%BB%E5%8A%A1%E9%99%84%E4%BB%B6%E6%B5%8B%E8%AF%95.xlsx");
    expect(response.send).toHaveBeenCalledWith(Buffer.from("xlsx bytes"));
  });
});
