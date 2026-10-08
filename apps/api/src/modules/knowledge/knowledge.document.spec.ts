import {
  cleanKnowledgeHtml,
  knowledgeHtmlContent,
  knowledgeContentHtml,
  knowledgeContentMarkdown,
} from "./knowledge.document";
import { canonicalKnowledgeContent } from "./knowledge.content";
import { knowledgeFile } from "./knowledge.file";
import sharp from "sharp";

describe("Knowledge documents", () => {
  it("imports headings, marks, lists, links, code, table and merged cells", () => {
    const body = knowledgeHtmlContent(
      '<h1>公司制度</h1><p><strong>加粗</strong><em>斜体</em><a href="https://example.com">链接</a></p><ol start="3"><li>步骤</li></ol><pre>const x=1</pre><table><tr><th>表头</th><td colspan="2">合并格</td></tr></table><hr>',
      () => null,
    );
    const json = JSON.stringify(body);
    for (const type of [
      "heading",
      "bold",
      "italic",
      "link",
      "orderedList",
      "codeBlock",
      "table",
      "tableHeader",
      "tableCell",
      "horizontalRule",
    ])
      expect(json).toContain(type);
    expect(json).toContain('"colspan":2');
    expect(canonicalKnowledgeContent(body).contentText).toContain("合并格");
  });
  it.each([
    "<script>alert(1)</script>",
    '<iframe src="file:///etc/passwd">secret</iframe>',
    '<p onclick="alert(1)">安全</p><a href="javascript:alert(1)">链接</a>',
    '<svg onload="alert(1)"><script>danger</script></svg>',
  ])("removes HTML execution and dangerous URLs %s", (html) => {
    const safe = cleanKnowledgeHtml(html);
    expect(safe).not.toMatch(/script|onclick|iframe|javascript:|onload/);
    expect(() => knowledgeHtmlContent(html, () => null)).not.toThrow();
  });
  it("discards remote images without fetching them", () => {
    const image = jest.fn().mockReturnValue(null);
    const body = knowledgeHtmlContent(
      '<p>正文</p><img src="https://remote/private">',
      image,
    );
    expect(JSON.stringify(body)).not.toContain("https://remote");
  });
  it("exports inert HTML and usable Markdown", () => {
    const body = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "标题" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: '<script>"&', marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(knowledgeContentHtml(body, () => "")).toContain(
      "&lt;script&gt;&quot;&amp;",
    );
    expect(knowledgeContentMarkdown(body, () => "")).toContain("## 标题");
    expect(knowledgeContentMarkdown(body, () => "")).toContain("**");
  });
  it("validates a real PNG and keeps safe filenames", async () => {
    const buffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const out = await knowledgeFile({
      originalname: "../../图片.png",
      buffer,
    } as Express.Multer.File);
    expect(out.name).not.toContain("/");
    expect(out.contentType).toBe("image/png");
    expect((await sharp(out.body).metadata()).width).toBe(2);
  });
  it.each([
    { originalname: "x.png", buffer: Buffer.from("<svg onload=evil>") },
    { originalname: "x.pdf", buffer: Buffer.from("html") },
    { originalname: "x.exe", buffer: Buffer.from("binary") },
    { originalname: "x.txt", buffer: Buffer.from([0]) },
  ])("rejects forged type %s", async (file) => {
    await expect(knowledgeFile(file as Express.Multer.File)).rejects.toThrow();
  });
});
