import type { KnowledgePage } from "@kdos/contracts";
import { hasFieldPermission, hasResourcePermission } from "../../shared/KdosDataTable";

export function canPublishKnowledge(page: KnowledgePage) {
  return Boolean(
    page.canEdit &&
    (page.status === "DRAFT" || page.status === "PUBLISHED") &&
    hasResourcePermission("knowledge-pages", "update") &&
    hasFieldPermission("knowledge-pages", "status", "update") &&
    ["status", "title", "content", "contentText", "tags", "attachmentIds"].every(
      (field) => hasFieldPermission("knowledge-pages", field, "read"),
    ),
  );
}
