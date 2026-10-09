import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { validateKnowledgeUpload } from "./knowledge.upload";
import { createKnowledgeDocxFixture } from "./knowledge.test-documents";
describe("Knowledge bounded disk uploads", () => {
  let folder: string;
  beforeEach(async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "kdos-upload-test-"));
  });
  afterEach(async () => {
    await fs.rm(folder, { recursive: true, force: true });
  });
  async function file(name: string, buffer: Buffer) {
    const filename = path.join(folder, "input");
    await fs.writeFile(filename, buffer);
    return {
      path: filename,
      size: buffer.length,
      originalname: name,
    } as Express.Multer.File;
  }
  it("accepts a valid Office archive and preserves a Chinese original name/hash", async () => {
    const body = await createKnowledgeDocxFixture();
    const result = await validateKnowledgeUpload(
      await file("制度说明.docx", body),
    );
    expect(result.name).toBe("制度说明.docx");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.size).toBe(body.length);
  });
  it("accepts a PDF larger than the old20MB limit without an upload buffer", async () => {
    const body = Buffer.concat([
      Buffer.from("%PDF-1.7\n%"),
      Buffer.alloc(21 * 1024 * 1024, 32),
      Buffer.from("\n%%EOF"),
    ]);
    const uploaded = await file("large.pdf", body);
    expect(uploaded.buffer).toBeUndefined();
    const result = await validateKnowledgeUpload(uploaded);
    expect(result.size).toBeGreaterThan(20 * 1024 * 1024);
  });
  it.each(["fake.docx", "fake.pdf", "fake.png", "fake.exe"])(
    "rejects disguised content %s",
    async (name) => {
      await expect(
        validateKnowledgeUpload(await file(name, Buffer.from("invalid"))),
      ).rejects.toThrow();
    },
  );
  it("reports encrypted containers before Office parsing", async () => {
    await expect(
      validateKnowledgeUpload(
        await file("secret.xlsx", Buffer.from([0x88, 0x7d, 0x1c, 0, 1])),
      ),
    ).rejects.toThrow("该文件被加密,请解密后再导入.");
  });
  it("rejects a damaged zip", async () => {
    await expect(
      validateKnowledgeUpload(
        await file("broken.pptx", Buffer.from("504b0304deadbeef", "hex")),
      ),
    ).rejects.toThrow("损坏");
  });
  it("rejects a compression bomb before unpacking every entry", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "types");
    zip.file("word/document.xml", "x".repeat(5 * 1024 * 1024));
    const body = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    await expect(
      validateKnowledgeUpload(await file("bomb.docx", body)),
    ).rejects.toThrow("解压");
  });
  it("rejects Office family spoofing", async () => {
    const body = await createKnowledgeDocxFixture();
    await expect(
      validateKnowledgeUpload(await file("fake.xlsx", body)),
    ).rejects.toThrow("格式");
  });
});
