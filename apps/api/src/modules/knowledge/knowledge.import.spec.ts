import { KnowledgeImportService } from "./knowledge.import.service";
import { createKnowledgeDocxFixture } from "./knowledge.test-documents";
const actor = {
  tenantId: "TEST",
  userId: null,
  username: "test",
  requestId: "test",
  permissions: ["*"],
  isSystemAdmin: true,
};
const imports = () => new KnowledgeImportService({} as never, {} as never);
describe("Knowledge import preview", () => {
  it("preserves DOCX heading, styles, list, table, hyperlink and embedded PNG", async () => {
    const service = imports();
    const preview = await service.preview(
      {
        originalname: "制度.docx",
        buffer: await createKnowledgeDocxFixture(),
      } as Express.Multer.File,
      actor,
    );
    const json = JSON.stringify(preview.content);
    for (const kind of [
      "heading",
      "bold",
      "italic",
      "bulletList",
      "table",
      "link",
      "attachmentImage",
    ])
      expect(json).toContain(kind);
    expect(preview.images).toHaveLength(1);
    expect(preview.contentText).toContain("DOCX导入正文");
    service.onModuleDestroy();
  });
  it("runs unified encryption detection before format parsing", async () => {
    await expect(
      imports().preview(
        {
          originalname: "加密.docx",
          buffer: Buffer.from([0x88, 0x7d, 0x1c, 0xd6]),
        } as Express.Multer.File,
        actor,
      ),
    ).rejects.toThrow("该文件被加密,请解密后再导入.");
  });
  it("rejects an invalid DOCX signature", async () => {
    await expect(
      imports().preview(
        {
          originalname: "bad.docx",
          buffer: Buffer.from("html"),
        } as Express.Multer.File,
        actor,
      ),
    ).rejects.toThrow("格式");
  });
  it("requires platform import permission before reading content", async () => {
    await expect(
      imports().preview(
        {
          originalname: "x.html",
          buffer: Buffer.from("正文"),
        } as Express.Multer.File,
        { ...actor, isSystemAdmin: false, permissions: [] },
      ),
    ).rejects.toThrow("权限");
  });
  it("strips HTML XSS and never downloads remote images", async () => {
    const preview = await imports().preview(
      {
        originalname: "x.html",
        buffer: Buffer.from(
          '<script>alert(1)</script><p onclick="evil()">安全</p><img src="http://127.0.0.1/private">',
        ),
      } as Express.Multer.File,
      actor,
    );
    expect(preview.contentText).toBe("安全");
    expect(preview.images).toHaveLength(0);
    expect(preview.warnings.join("")).toContain("外部");
  });
  it("rejects excessively nested HTML before recursive conversion", async () => {
    await expect(
      imports().preview(
        {
          originalname: "x.html",
          buffer: Buffer.from(
            "<div>".repeat(80) + "正文" + "</div>".repeat(80),
          ),
        } as Express.Multer.File,
        actor,
      ),
    ).rejects.toThrow("嵌套");
  });
});
