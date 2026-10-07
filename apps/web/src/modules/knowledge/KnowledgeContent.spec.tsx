import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeContent } from "./KnowledgeContent";
import { knowledgeFileUrl } from "./knowledge-ui";
afterEach(cleanup);
describe("Knowledge safe reader", () => {
  it("renders script/HTML-like text as inert text", () => { const view = render(<KnowledgeContent content={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: '<script>alert(1)</script><img src=x onerror=alert(1)>' }] }] }} />); expect(view.container.querySelector("script")).toBeNull(); expect(view.container.querySelector("img")).toBeNull(); expect(view.container.textContent).toContain("<script>"); });
  it("never renders javascript links or unknown iframe nodes", () => { const view = render(<KnowledgeContent content={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "链接", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }, { type: "iframe", attrs: { src: "https://external" } }] }} />); expect(view.container.querySelector("a")).toBeNull(); expect(view.container.querySelector("iframe")).toBeNull(); });
  it("keeps private image/download routes authenticated and version-specific", () => { expect(knowledgeFileUrl("file")).toBe("/knowledge/attachments/file"); expect(knowledgeFileUrl("file", { mode: "manage", version: 2 })).toBe("/knowledge/attachments/file?mode=manage&version=2"); });
});
