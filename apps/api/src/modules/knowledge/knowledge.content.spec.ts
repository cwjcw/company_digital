import {
  canonicalKnowledgeContent,
  knowledgeSafeLink,
  knowledgeTags,
  knowledgeId,
} from "./knowledge.content";

describe("Knowledge canonical content", () => {
  it("derives trusted plain text/hash from structured content, retaining Chinese", () => {
    const result = canonicalKnowledgeContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "员工请假管理办法" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "年度员工绩效考核制度",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    });
    expect(result.contentText).toBe("员工请假管理办法\n年度员工绩效考核制度");
    expect(result.contentHash).toHaveLength(64);
    expect(canonicalKnowledgeContent(result.content)).toEqual(result);
  });
  it.each([
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="javascript:alert(1)">X</a>',
  ])("rejects untrusted HTML %s", (html) =>
    expect(() => canonicalKnowledgeContent(html)).toThrow(),
  );
  it.each(["script", "iframe", "image"])(
    "rejects executable/remote node %s",
    (type) =>
      expect(() =>
        canonicalKnowledgeContent({
          type: "doc",
          content: [{ type, attrs: { src: "https://external/image" } }],
        }),
      ).toThrow(),
  );
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>",
    "java\nscript:alert(1)",
  ])("rejects unsafe link %s", (href) =>
    expect(() => knowledgeSafeLink(href)).toThrow(),
  );
  it("rejects event attributes and forged contentText", () => {
    expect(() =>
      canonicalKnowledgeContent({
        type: "doc",
        contentText: "forged",
        content: [],
      }),
    ).toThrow();
    expect(() =>
      canonicalKnowledgeContent({
        type: "doc",
        content: [{ type: "paragraph", attrs: { onclick: "alert(1)" } }],
      }),
    ).toThrow();
  });
  it("treats HTML-like text as text, never markup", () =>
    expect(
      canonicalKnowledgeContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "<script>alert(1)</script>" }],
          },
        ],
      }).contentText,
    ).toBe("<script>alert(1)</script>"));
  it.each([
    { marks: {} },
    { marks: [null] },
    { content: [{ type: "iframe" }] },
  ])("rejects malformed JSON with business errors %j", (patch) => {
    expect(() =>
      canonicalKnowledgeContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "安全", ...patch }],
          },
        ],
      }),
    ).toThrow();
  });
  it("rejects legal nodes in an invalid tree position", () =>
    expect(() =>
      canonicalKnowledgeContent({
        type: "doc",
        content: [{ type: "text", text: "非法结构" }],
      }),
    ).toThrow("位置无效"));
  it("normalizes tags independently of categories", () => {
    expect(knowledgeTags(["休假", "休假", "考勤"])).toEqual(["休假", "考勤"]);
    expect(() => knowledgeTags("休假,考勤")).toThrow();
  });
  it("requires stable IDs, not display names", () => {
    expect(() => knowledgeId("张三")).toThrow();
    expect(knowledgeId("00000000-0000-7000-8000-000000000001")).toBe(
      "00000000-0000-7000-8000-000000000001",
    );
  });
});
