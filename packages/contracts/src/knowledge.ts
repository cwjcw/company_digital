/** KDOS Knowledge 2.1. Content is canonical structured JSON; identities are stable UUIDs. */
export type KnowledgeContentMode = "RICH_TEXT" | "FILE";
export type KnowledgeFileRole = "PRIMARY" | "INLINE" | "SUPPLEMENTAL";
export type KnowledgePreviewStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
export type KnowledgeStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED" | "TRASHED";
export type KnowledgeAccessLevel = "VIEWER" | "EDITOR" | "FULL_ACCESS";
export type KnowledgeAccessEntry = {
  subjectType: "ALL" | "ORGANIZATION" | "ROLE" | "USER";
  subjectId: string | null;
  accessLevel: KnowledgeAccessLevel;
};
export type KnowledgeContentNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: KnowledgeContentNode[];
};
export type KnowledgeAttachment = {
  id: string;
  pageId: string;
  role?: KnowledgeFileRole;
  previewStatus?: KnowledgePreviewStatus;
  originalName: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
};
export type KnowledgeSpace = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  sortOrder: number;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  accessLevel?: KnowledgeAccessLevel;
  canManage?: boolean;
  canCreate?: boolean;
};
export type KnowledgeBreadcrumb = { id: string; title: string };
export type KnowledgePage = {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  slug: string;
  status: KnowledgeStatus;
  sortOrder: number;
  version: number;
  contentMode?: KnowledgeContentMode;
  description?: string;
  primaryFile?: KnowledgeAttachment | null;
  content?: KnowledgeContentNode;
  contentText?: string;
  contentHash?: string;
  tags?: string[];
  attachments?: KnowledgeAttachment[];
  publishedVersionId?: string | null;
  publishedVersion?: number;
  /** Current working data differs from the publication; only returned to authorized publishers. */
  hasUnpublishedChanges?: boolean;
  publishedAt?: string;
  publishedBy?: string;
  publisherName?: string;
  breadcrumb?: KnowledgeBreadcrumb[];
  spaceName?: string;
  snippet?: string;
  relevance?: number;
  hasChildren?: boolean;
  accessRestricted?: boolean;
  access?: KnowledgeAccessEntry[];
  canEdit?: boolean;
  canManage?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
};
export type KnowledgePageInput = {
  spaceId: string;
  parentId?: string | null;
  title?: string;
  contentMode?: KnowledgeContentMode;
  description?: string;
  content?: KnowledgeContentNode;
  tags?: string[];
  sortOrder?: number;
};
export type KnowledgeSpaceCreateInput = {
  name: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
};
export type KnowledgeLocation = Pick<KnowledgePage, "id" | "title" | "parentId" | "breadcrumb" | "hasChildren">;
export type KnowledgeLocationResult = { rows: KnowledgeLocation[]; total: number; page: number; pageSize: number };
export type KnowledgeImportPreview = {
  token: string;
  title: string;
  content: KnowledgeContentNode;
  contentText: string;
  images: Array<{ index: number; name: string }>;
  warnings: string[];
  expiresAt: string;
};
export const knowledgeStatusOptions = [
  { value: "DRAFT", label: "草稿" },
  { value: "PUBLISHED", label: "已发布" },
  { value: "ARCHIVED", label: "已归档" },
  { value: "TRASHED", label: "回收站" },
];
export const knowledgeAccessLevelOptions = [
  { value: "VIEWER", label: "只读" },
  { value: "EDITOR", label: "编辑" },
  { value: "FULL_ACCESS", label: "完全管理" },
];

export type KnowledgePageUpdateInput = Partial<
  Pick<KnowledgePageInput, "title" | "content" | "tags" | "sortOrder" | "description">
> & { expectedVersion: number };
export type KnowledgeVersionCommand = { expectedVersion: number };
