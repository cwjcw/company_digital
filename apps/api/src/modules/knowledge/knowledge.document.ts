import { BadRequestException } from "@nestjs/common";
import { parse, HTMLElement, NodeType, type Node } from "node-html-parser";
import sanitizeHtml from "sanitize-html";
import type { KnowledgeContentNode as C } from "@kdos/contracts";
import { canonicalKnowledgeContent } from "./knowledge.content";

export const cleanKnowledgeHtml = (html: string) =>
  sanitizeHtml(html, {
    allowedTags: [
      "p",
      "div",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "del",
      "u",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "table",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "td",
      "th",
      "pre",
      "code",
      "br",
      "hr",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data", "knowledge-image"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: [
      "script",
      "style",
      "textarea",
      "option",
      "noscript",
      "iframe",
      "object",
    ],
  });
/** Sanitized HTML becomes the same canonical JSON as the editor; no raw HTML persists. */
export function knowledgeHtmlContent(
  html: string,
  image: (src: string, alt: string) => C | null,
): C {
  if (Buffer.byteLength(html) > 2 * 1024 * 1024)
    throw new BadRequestException("转换后的正文超过2MB，请拆分文档");
  const root = parse(cleanKnowledgeHtml(html));
  const stack: Array<{ node: Node; depth: number }> = root.childNodes.map(
    (node) => ({ node, depth: 0 }),
  );
  let count = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++count > 20000 || item.depth > 40)
      throw new BadRequestException("导入正文节点过多或嵌套过深");
    for (const child of item.node.childNodes ?? [])
      stack.push({ node: child, depth: item.depth + 1 });
  }
  const inline = (nodes: Node[], marks: NonNullable<C["marks"]> = []): C[] =>
    nodes.flatMap((n) => {
      if (n.nodeType === NodeType.TEXT_NODE)
        return n.textContent
          ? [{ type: "text", text: n.textContent, marks }]
          : [];
      if (!(n instanceof HTMLElement)) return [];
      const tag = n.tagName.toLowerCase();
      if (tag === "br") return [{ type: "hardBreak" }];
      if (tag === "img") return [];
      const type = (
        {
          strong: "bold",
          b: "bold",
          em: "italic",
          i: "italic",
          s: "strike",
          del: "strike",
          u: "underline",
          code: "code",
          a: "link",
        } as Record<string, string>
      )[tag];
      const mark =
        type === "link"
          ? n.getAttribute("href")
            ? { type, attrs: { href: n.getAttribute("href") } }
            : null
          : type
            ? { type }
            : null;
      return inline(n.childNodes, mark ? [...marks, mark] : marks);
    });
  const blocks = (nodes: Node[]): C[] => {
    const result: C[] = [];
    let pending: Node[] = [];
    const flush = () => {
      const content = inline(pending);
      if (content.some((n) => n.text?.trim() || n.type === "hardBreak"))
        result.push({ type: "paragraph", content });
      pending = [];
    };
    for (const n of nodes) {
      if (!(n instanceof HTMLElement)) {
        pending.push(n);
        continue;
      }
      const tag = n.tagName.toLowerCase();
      if (tag === "img") {
        flush();
        const out = image(
          n.getAttribute("src") ?? "",
          n.getAttribute("alt") ?? "",
        );
        if (out) result.push(out);
        continue;
      }
      if (
        [
          "p",
          "div",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "ul",
          "ol",
          "blockquote",
          "pre",
          "table",
          "hr",
        ].includes(tag)
      ) {
        flush();
        if (tag === "hr") {
          result.push({ type: "horizontalRule" });
          continue;
        }
        if (tag === "table") {
          const rows = n
            .querySelectorAll("tr")
            .filter((r) => r.closest("table") === n)
            .map((r) => ({
              type: "tableRow",
              content: r.childNodes
                .filter(
                  (c) =>
                    c instanceof HTMLElement &&
                    ["TD", "TH"].includes(c.tagName),
                )
                .map((c) => {
                  const cell = c as HTMLElement;
                  return {
                    type: cell.tagName === "TH" ? "tableHeader" : "tableCell",
                    attrs: {
                      colspan: Number(cell.getAttribute("colspan") ?? 1),
                      rowspan: Number(cell.getAttribute("rowspan") ?? 1),
                      colwidth: null,
                    },
                    content: blocks(cell.childNodes).length
                      ? blocks(cell.childNodes)
                      : [{ type: "paragraph" }],
                  };
                }),
            }))
            .filter((r) => r.content.length);
          if (rows.length) result.push({ type: "table", content: rows });
          continue;
        }
        if (tag === "ul" || tag === "ol") {
          result.push({
            type: tag === "ul" ? "bulletList" : "orderedList",
            ...(tag === "ol"
              ? { attrs: { start: Number(n.getAttribute("start") ?? 1) } }
              : {}),
            content: n.childNodes
              .filter((c) => c instanceof HTMLElement && c.tagName === "LI")
              .map((c) => ({
                type: "listItem",
                content: blocks(c.childNodes).length
                  ? blocks(c.childNodes)
                  : [{ type: "paragraph" }],
              })),
          });
          continue;
        }
        if (tag === "blockquote") {
          result.push({ type: "blockquote", content: blocks(n.childNodes) });
          continue;
        }
        if (tag === "pre") {
          result.push({
            type: "codeBlock",
            content: n.textContent
              ? [{ type: "text", text: n.textContent }]
              : [],
          });
          continue;
        }
        if (/^h[1-6]$/.test(tag)) {
          result.push({
            type: "heading",
            attrs: { level: Math.min(3, Number(tag[1])) },
            content: inline(n.childNodes),
          });
          continue;
        }
        if (n.querySelector("p,div,table,ul,ol,img,blockquote,pre,h1,h2,h3")) {
          result.push(...blocks(n.childNodes));
          continue;
        }
        result.push({ type: "paragraph", content: inline(n.childNodes) });
        continue;
      }
      pending.push(n);
    }
    flush();
    return result;
  };
  return canonicalKnowledgeContent({
    type: "doc",
    content: blocks(root.childNodes),
  }).content;
}
const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function knowledgeContentHtml(
  content: C,
  image: (id: string) => string,
): string {
  const render = (n: C): string => {
    if (n.type === "text") {
      let s = esc(n.text);
      for (const m of n.marks ?? []) {
        const tag = (
          {
            bold: "strong",
            italic: "em",
            strike: "s",
            underline: "u",
            code: "code",
          } as Record<string, string>
        )[m.type];
        if (tag) s = `<${tag}>${s}</${tag}>`;
        else if (m.type === "link")
          s = `<a href="${esc(m.attrs?.href)}" rel="noopener noreferrer">${s}</a>`;
      }
      return s;
    }
    if (n.type === "attachmentImage")
      return `<img src="${esc(image(String(n.attrs?.attachmentId)))}" alt="${esc(n.attrs?.alt)}">`;
    if (n.type === "horizontalRule") return "<hr>";
    if (n.type === "hardBreak") return "<br>";
    const tag = (
      {
        doc: "div",
        paragraph: "p",
        heading: `h${n.attrs?.level ?? 2}`,
        bulletList: "ul",
        orderedList: "ol",
        listItem: "li",
        blockquote: "blockquote",
        codeBlock: "pre",
        callout: "aside",
        table: "table",
        tableRow: "tr",
        tableCell: "td",
        tableHeader: "th",
      } as Record<string, string>
    )[n.type];
    if (!tag) return "";
    const attrs =
      n.type === "tableCell" || n.type === "tableHeader"
        ? ` colspan="${Number(n.attrs?.colspan ?? 1)}" rowspan="${Number(n.attrs?.rowspan ?? 1)}"`
        : n.type === "orderedList"
          ? ` start="${Number(n.attrs?.start ?? 1)}"`
          : "";
    return `<${tag}${attrs}>${(n.content ?? []).map(render).join("")}</${tag}>`;
  };
  return render(content);
}
export function knowledgeContentMarkdown(
  content: C,
  image: (id: string) => string,
): string {
  const r = (n: C): string => {
    if (n.type === "text") {
      let s = (n.text ?? "").replace(/[\\`*_{}[\]<>]/g, "\\$&");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") s = `**${s}**`;
        if (m.type === "italic") s = `*${s}*`;
        if (m.type === "code") s = `\`${n.text}\``;
        if (m.type === "link")
          s = `[${s}](${String(m.attrs?.href).replace(/[()]/g, (c) => encodeURIComponent(c))})`;
      }
      return s;
    }
    const children = (n.content ?? []).map(r).join("");
    if (n.type === "attachmentImage")
      return `![${String(n.attrs?.alt ?? "").replace(/[[\]]/g, "")}](${image(String(n.attrs?.attachmentId))})\n\n`;
    if (n.type === "table") return knowledgeContentHtml(n, image) + "\n\n";
    if (n.type === "heading")
      return `${"#".repeat(Number(n.attrs?.level ?? 2))} ${children}\n\n`;
    if (n.type === "paragraph") return children + "\n\n";
    if (n.type === "bulletList" || n.type === "orderedList")
      return (
        (n.content ?? [])
          .map(
            (c, i) =>
              `${n.type === "orderedList" ? `${i + Number(n.attrs?.start ?? 1)}.` : "-"} ${r(c).trim().replace(/\n/g, "\n  ")}`,
          )
          .join("\n") + "\n\n"
      );
    if (n.type === "blockquote" || n.type === "callout")
      return (
        children
          .trim()
          .split("\n")
          .map((s) => "> " + s)
          .join("\n") + "\n\n"
      );
    if (n.type === "codeBlock")
      return `\`\`\`\n${(n.content ?? []).map((c) => c.text ?? "").join("")}\n\`\`\`\n\n`;
    if (n.type === "hardBreak") return "  \n";
    if (n.type === "horizontalRule") return "---\n\n";
    return children;
  };
  return r(content);
}
