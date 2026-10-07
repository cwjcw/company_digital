import { createContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { KnowledgeCategory, KnowledgeContentNode } from "@kdos/contracts";
import { api } from "../../api";
import { hasResourcePermission } from "../../shared/KdosDataTable";

export const KnowledgeFileContext = createContext<{ mode?: "manage"; version?: number }>({});
export function knowledgeFileUrl(id: string, context: { mode?: "manage"; version?: number } = {}) {
  const params = new URLSearchParams(); if (context.mode) params.set("mode", context.mode); if (context.version) params.set("version", String(context.version));
  return `/knowledge/attachments/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`;
}
export const emptyKnowledgeContent: KnowledgeContentNode = { type: "doc", content: [{ type: "paragraph" }] };

export function useKnowledgeCategories() {
  const manage = ["create", "update", "delete"].some((action) => hasResourcePermission("knowledge-categories", action));
  return useQuery({ queryKey: ["knowledge", "categories", manage], queryFn: () => api<KnowledgeCategory[]>(`/knowledge/categories${manage ? "?mode=manage" : ""}`), enabled: hasResourcePermission("knowledge-categories", "read") });
}
