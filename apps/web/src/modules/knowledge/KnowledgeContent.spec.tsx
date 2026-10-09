import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "antd";
import { KnowledgeContent, KnowledgeRichEditor } from "./KnowledgeContent";
import { knowledgeFileUrl } from "./knowledge-ui";
afterEach(cleanup);
describe("Knowledge safe reader", () => {
  it("renders script/HTML-like text as inert text", () => {
    const view = render(
      <KnowledgeContent
        content={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "<script>alert(1)</script><img src=x onerror=alert(1)>",
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.textContent).toContain("<script>");
  });
  it("never renders javascript links or unknown iframe nodes", () => {
    const view = render(
      <KnowledgeContent
        content={{
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "链接",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
            { type: "iframe", attrs: { src: "https://external" } },
          ],
        }}
      />,
    );
    expect(view.container.querySelector("a")).toBeNull();
    expect(view.container.querySelector("iframe")).toBeNull();
  });
  it("keeps private image/download routes authenticated and version-specific", () => {
    expect(knowledgeFileUrl("file")).toBe("/knowledge/files/file/original");
    expect(knowledgeFileUrl("file", { mode: "working", versionId: "v2" })).toBe(
      "/knowledge/files/file/original?mode=working&versionId=v2",
    );
  });
});

describe("Knowledge real rich editor", () => {
  it("does not autosave unchanged content when busy/editable state changes", async () => {
    const onChange = vi.fn();
    const value = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "已发布正文" }] },
      ],
    };
    const element = (disabled: boolean) => (
      <App>
        <KnowledgeRichEditor
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </App>
    );
    const view = render(element(false));
    await waitFor(() =>
      expect(
        view.container
          .querySelector(".tiptap")
          ?.getAttribute("contenteditable"),
      ).toBe("true"),
    );
    view.rerender(element(true));
    await waitFor(() =>
      expect(
        view.container
          .querySelector(".tiptap")
          ?.getAttribute("contenteditable"),
      ).toBe("false"),
    );
    view.rerender(element(false));
    await waitFor(() =>
      expect(
        view.container
          .querySelector(".tiptap")
          ?.getAttribute("contenteditable"),
      ).toBe("true"),
    );
    expect(view.container.querySelector(".tiptap")?.textContent).toContain(
      "已发布正文",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
