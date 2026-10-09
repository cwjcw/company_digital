import { KnowledgeFilesService } from "./knowledge.files.service";
import { validateKnowledgeUpload } from "./knowledge.upload";
import type { KnowledgeActor } from "./knowledge.types";
jest.mock("./knowledge.upload", () => ({ validateKnowledgeUpload: jest.fn() }));
const spaceId = "019aaa80-0000-7000-8000-000000000001",
  key = "019aaa80-0000-7000-8000-000000000002";
const actor: KnowledgeActor = {
  tenantId: "FIXTURE",
  userId: null,
  username: "fixture",
  permissions: ["*"],
  requestId: "title-test",
};
function fixture() {
  const persisted = new Map<string, { request_hash: string; result: any }>();
  const manager = {
    query: jest.fn(async (sql: string, params: any[]) => {
      if (sql.startsWith("SELECT request_hash"))
        return persisted.has(params[2]) ? [persisted.get(params[2])] : [];
      if (sql.startsWith("INSERT INTO knowledge_file_upload_requests"))
        persisted.set(params[2], {
          request_hash: params[3],
          result: JSON.parse(params[4]),
        });
      return [];
    }),
  };
  const app = {
    keys: jest.fn(),
    command: jest.fn(async (_actor, work) => work(manager)),
    createPageIn: jest.fn(async (_m, input) => ({
      id: spaceId,
      title: input.title,
      status: "DRAFT",
    })),
    lockPage: jest.fn(),
  };
  const service = new KnowledgeFilesService(
    app as never,
    {} as never,
    {} as never,
  );
  const store = jest
    .spyOn(service as any, "store")
    .mockResolvedValue({
      attachment: { id: key, originalName: "原文件.docx" },
    });
  return { service, app, store, persisted };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(validateKnowledgeUpload)
    .mockResolvedValue({
      name: "原文件.docx",
    extension: "docx",
      sha256: "abc",
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 10,
    });
});
it.each([undefined, "自定义中文知识标题", "字".repeat(300)])(
  "accepts default/custom/max-length upload title %s",
  async (title) => {
    const { service, app } = fixture();
    await service.create(
      {
        spaceId,
        idempotencyKey: key,
        ...(title === undefined ? {} : { title }),
      },
      {} as never,
      actor,
    );
    expect(app.createPageIn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: title ?? "原文件",
        contentMode: "FILE",
      }),
      actor,
    );
  },
);
it.each(["", " ", "字".repeat(301)])(
  "rejects invalid title before issuing a write %s",
  async (title) => {
    const { service, app } = fixture();
    await expect(
      service.create(
        { spaceId, title, idempotencyKey: key },
        {} as never,
        actor,
      ),
    ).rejects.toThrow(/标题/);
    expect(app.command).not.toHaveBeenCalled();
  },
);
it("replays a committed request whose response was lost and rejects altered titles under the same key", async () => {
  const { service, app, store, persisted } = fixture(),
    input = { spaceId, title: "固定标题", idempotencyKey: key },
    file = {} as Express.Multer.File;
  await service.create(input, file, actor); // Server committed; client receives no response.
  const retry = await service.create(input, file, actor);
  expect(retry.repeated).toBe(true);
  expect(app.createPageIn).toHaveBeenCalledTimes(1);
  expect(store).toHaveBeenCalledTimes(1);
  expect(persisted.size).toBe(1);
  await expect(
    service.create({ ...input, title: "改过标题" }, file, actor),
  ).rejects.toThrow(/不一致/);
  expect(app.lockPage).toHaveBeenCalledWith(
    expect.anything(),
    spaceId,
    actor,
    "create",
    2,
  );
});
it("retains backend create and title-field authorization", async () => {
  const { service, app } = fixture(),
    input = { spaceId, title: "标题", idempotencyKey: key };
  await expect(
    service.create(input, {} as never, { ...actor, permissions: [] }),
  ).rejects.toThrow(/权限/);
  await expect(
    service.create(input, {} as never, {
      ...actor,
      permissions: [
        "knowledge-pages:*:create",
        "knowledge-pages:spaceId:update",
        "knowledge-pages:parentId:update",
        "knowledge-pages:attachmentIds:update",
      ],
    }),
  ).rejects.toThrow(/title/);
  expect(app.command).not.toHaveBeenCalled();
});
