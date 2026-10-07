/** Knowledge Phase 1 wire contracts. Content is structured JSON, never trusted HTML. */
export type KnowledgeStatus = "DRAFT" | "PUBLISHED" | "DISABLED";
export type KnowledgeVisibility = { type: "ALL" | "ORGANIZATION" | "ROLE" | "USER"; subjectIds: string[] };
export type KnowledgeContentNode = {
  type: string; text?: string; attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: KnowledgeContentNode[];
};
export type KnowledgeAttachment = { id: string; articleId: string; originalName: string; contentType: string; size: number; sha256: string; createdAt: string };
export type KnowledgeCategory = {
  id: string; parentId: string | null; level: number; code: string; name: string; description: string | null;
  sortOrder: number; enabled: boolean; version: number;
};
export type KnowledgeArticle = {
  id: string; version: number; title?: string; summary?: string; categoryId?: string;
  rootCategoryName?: string; categoryName?: string; tags?: string[]; status?: KnowledgeStatus;
  content?: KnowledgeContentNode; contentText?: string; contentHash?: string; visibility?: KnowledgeVisibility;
  attachmentIds?: string[]; attachments?: KnowledgeAttachment[]; workingRevision?: number; publishedVersion?: number;
  publishedBy?: string; publisherName?: string; publishedAt?: string; viewCount?: number;
  createdBy?: string; createdAt?: string; updatedBy?: string; updatedAt?: string; relevance?: number; snippet?: string;
};
export type KnowledgeArticleInput = { title: string; summary?: string; categoryId: string; content: KnowledgeContentNode;
  tags?: string[]; visibility?: KnowledgeVisibility; attachmentIds?: string[]; expectedVersion?: number };
export const knowledgeStatusOptions = [{ value: "DRAFT", label: "草稿" }, { value: "PUBLISHED", label: "已发布" }, { value: "DISABLED", label: "已停用" }];
export const knowledgeVisibilityOptions = [{ value: "ALL", label: "全公司" }, { value: "ORGANIZATION", label: "指定组织/部门" }, { value: "ROLE", label: "指定角色" }, { value: "USER", label: "指定人员" }];
