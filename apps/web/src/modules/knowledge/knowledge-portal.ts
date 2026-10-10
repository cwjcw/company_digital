import { useQuery } from "@tanstack/react-query";
import type { KnowledgeCapabilities, KnowledgePage } from "@kdos/contracts";
import { api } from "../../api";
import { hasResourcePermission } from "../../shared/KdosDataTable";
export function useKnowledgeCapabilities() {
  return useQuery({ queryKey: ["knowledge", "capabilities"], queryFn: () => api<KnowledgeCapabilities>("/knowledge/capabilities"),
    enabled: hasResourcePermission("knowledge-pages", "read") && hasResourcePermission("knowledge-spaces", "read"), staleTime: 0 });
}
export function knowledgeFileType(page: KnowledgePage) {
  if (page.contentMode === "RICH_TEXT") return "在线文章";
  const file = page.primaryFile;
  if (!file) return page.contentMode === "FILE" ? "文件" : undefined;
  const extension = file.originalName?.split(".").pop()?.toUpperCase();
  return extension && extension !== file.originalName?.toUpperCase() ? extension : "文件";
}
