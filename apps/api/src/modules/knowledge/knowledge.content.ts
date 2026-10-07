import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { KnowledgeContentNode, KnowledgeVisibility } from "@kdos/contracts";

export const knowledgeUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function knowledgeId(value: unknown) { if (typeof value !== "string" || !knowledgeUuidPattern.test(value)) throw new BadRequestException("记录标识无效"); return value; }
export function knowledgeText(value: unknown, label: string, max: number, required = false) {
  if (value != null && typeof value !== "string") throw new BadRequestException(`${label}格式无效`);
  const text = String(value ?? "").trim(); if (text.length > max || (required && !text)) throw new BadRequestException(`${label}${required && !text ? "不能为空" : `最多 ${max} 字`}`); return text;
}
export function knowledgeIds(value: unknown, max = 20) {
  if (!Array.isArray(value) || value.length > max) throw new BadRequestException("标识列表无效或过长"); return [...new Set(value.map(knowledgeId))];
}
export function knowledgeVisibility(value: unknown): KnowledgeVisibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("可见范围无效");
  const raw = value as KnowledgeVisibility;
  if (!["ALL", "ORGANIZATION", "ROLE", "USER"].includes(raw.type)) throw new BadRequestException("可见范围类型无效");
  const subjectIds = knowledgeIds(raw.subjectIds, 200);
  if (raw.type === "ALL" && subjectIds.length || raw.type !== "ALL" && !subjectIds.length) throw new BadRequestException("请配置有效的可见范围成员");
  return { type: raw.type, subjectIds: subjectIds.sort() };
}
export function knowledgeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new BadRequestException("最多 20 个标签");
  return [...new Set(value.map((tag) => knowledgeText(tag, "标签", 100, true)))].sort();
}
export function knowledgeSafeLink(value: unknown) {
  if (typeof value !== "string" || value.length > 2000 || /\s/.test(value) || [...value].some((char) => char.charCodeAt(0) < 32)) throw new BadRequestException("链接无效");
  try { const url = new URL(value); if (!["https:", "http:", "mailto:"].includes(url.protocol)) throw new Error(); }
  catch { throw new BadRequestException("链接仅支持 http、https 或 mailto"); } return value;
}

/** Accept only TipTap's deliberately small JSON schema. Unknown nodes, attributes and HTML are rejected. */
export function canonicalKnowledgeContent(value: unknown) {
  if (JSON.stringify(value ?? null).length > 500_000) throw new BadRequestException("正文最多 500KB");
  let count = 0; const imageIds: string[] = [];
  const blocks = new Set(["doc", "paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem", "codeBlock", "horizontalRule", "hardBreak", "text", "attachmentImage"]);
  const normalize = (raw: unknown, depth: number): KnowledgeContentNode => {
    if (++count > 10000 || depth > 25 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequestException("正文结构无效或过于复杂");
    const node = raw as KnowledgeContentNode;
    if (!blocks.has(node.type) || Object.keys(node).some((key) => !["type", "text", "attrs", "marks", "content"].includes(key))) throw new BadRequestException("正文包含不支持的节点或属性");
    const attrs: Record<string, unknown> = {};
    if (node.attrs) {
      if (typeof node.attrs !== "object" || Array.isArray(node.attrs)) throw new BadRequestException("正文属性无效");
      const allowed = node.type === "heading" ? ["level"] : node.type === "orderedList" ? ["start", "type"] : node.type === "codeBlock" ? ["language"] : node.type === "attachmentImage" ? ["attachmentId", "alt"] : [];
      if (Object.keys(node.attrs).some((key) => !allowed.includes(key))) throw new BadRequestException("正文属性不受支持");
      if (node.type === "heading") { const level = Number(node.attrs.level); if (![1, 2, 3].includes(level)) throw new BadRequestException("标题层级无效"); attrs.level = level; }
      if (node.type === "orderedList") { const start = Number(node.attrs.start ?? 1); if (!Number.isInteger(start) || start < 1 || start > 10000) throw new BadRequestException("编号无效"); attrs.start = start; }
      if (node.type === "codeBlock") attrs.language = null;
      if (node.type === "attachmentImage") { attrs.attachmentId = knowledgeId(node.attrs.attachmentId); attrs.alt = knowledgeText(node.attrs.alt, "图片说明", 200); imageIds.push(String(attrs.attachmentId)); }
    } else if (["heading", "attachmentImage"].includes(node.type)) throw new BadRequestException("正文缺少必要属性");
    if (node.marks != null && !Array.isArray(node.marks)) throw new BadRequestException("正文样式必须是数组");
    const marks = node.marks?.map((mark) => {
      if (!mark || typeof mark !== "object" || Array.isArray(mark) || (mark.attrs != null && (typeof mark.attrs !== "object" || Array.isArray(mark.attrs)))) throw new BadRequestException("正文样式无效");
      if (!["bold", "italic", "strike", "underline", "code", "link"].includes(mark.type) || Object.keys(mark).some((key) => !["type", "attrs"].includes(key))) throw new BadRequestException("正文样式无效");
      if (mark.type === "link") {
        if (Object.keys(mark.attrs ?? {}).some((key) => !["href", "target", "rel", "class"].includes(key))) throw new BadRequestException("链接属性无效");
        return { type: "link", attrs: { href: knowledgeSafeLink(mark.attrs?.href), target: "_blank", rel: "noopener noreferrer nofollow", class: null } };
      }
      if (mark.attrs && Object.keys(mark.attrs).length) throw new BadRequestException("正文样式属性无效"); return { type: mark.type };
    });
    if (marks && (node.type !== "text" || marks.length > 8)) throw new BadRequestException("正文样式位置无效");
    if (node.type === "text") {
      if (typeof node.text !== "string" || !node.text || node.content || node.attrs) throw new BadRequestException("正文文本无效");
      return { type: "text", text: node.text, ...(marks?.length ? { marks } : {}) };
    }
    if (node.text != null) throw new BadRequestException("正文节点无效");
    if (node.content && !Array.isArray(node.content)) throw new BadRequestException("正文子节点无效");
    const inline = ["text", "hardBreak"];
    const block = ["paragraph", "heading", "blockquote", "bulletList", "orderedList", "codeBlock", "horizontalRule", "attachmentImage"];
    const allowedChildren = ["paragraph", "heading"].includes(node.type) ? inline : node.type === "codeBlock" ? ["text"] : ["bulletList", "orderedList"].includes(node.type) ? ["listItem"] : ["doc", "blockquote", "listItem"].includes(node.type) ? block : [];
    if ((node.content ?? []).some((child) => !child || !allowedChildren.includes(child.type))) throw new BadRequestException("正文子节点位置无效");
    return { type: node.type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(node.content ? { content: node.content.map((child) => normalize(child, depth + 1)) } : {}) };
  };
  const content = normalize(value, 0); if (content.type !== "doc") throw new BadRequestException("正文必须是结构化文档");
  const plain = (node: KnowledgeContentNode): string => node.type === "text" ? node.text ?? "" : node.type === "hardBreak" ? "\n" : node.type === "attachmentImage" ? String(node.attrs?.alt ?? "") : (node.content ?? []).map(plain).join("") + (["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(node.type) ? "\n" : "");
  return { content, contentText: plain(content).trim(), contentHash: createHash("sha256").update(JSON.stringify(content)).digest("hex"), imageIds: [...new Set(imageIds)] };
}
