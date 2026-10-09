import { createContext } from "react";
import type { KnowledgeContentNode } from "@kdos/contracts";
export type KnowledgeFileScope = {
  mode?: "published" | "working" | "trash";
  versionId?: string;
};
export const KnowledgeFileContext = createContext<KnowledgeFileScope>({});
export function knowledgeFileQuery(scope: KnowledgeFileScope = {}) {
  const params = new URLSearchParams();
  if (scope.mode) params.set("mode", scope.mode);
  if (scope.versionId) params.set("versionId", scope.versionId);
  return params.toString();
}
export function knowledgeFileUrl(id: string, scope: KnowledgeFileScope = {}) {
  const query = knowledgeFileQuery(scope);
  return `/knowledge/files/${encodeURIComponent(id)}/original${query ? `?${query}` : ""}`;
}
export const emptyKnowledgeContent: KnowledgeContentNode = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

/** Supports the current HTTP LAN deployment where the secure clipboard API is unavailable. */
export async function copyKnowledgeLink(id: string) {
  const value = `${window.location.origin}/knowledge/pages/${encodeURIComponent(id)}`;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    /* Use the browser's user-gesture fallback below. */
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.left = "-10000px";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy"))
      throw new Error("复制失败，请复制浏览器地址");
  } finally {
    input.remove();
  }
}

export function knowledgeCanRetry() {
  try {
    const user = JSON.parse(localStorage.getItem("sessionUser") ?? "{}");
    return (
      user.isSystemAdmin === true ||
      user.moduleAdminCodes?.includes("knowledge") === true
    );
  } catch {
    return false;
  }
}

export function knowledgeLocationUrl(spaceId: string, parameters: Record<string, string | undefined>) {
  return `/knowledge/spaces/${spaceId}/locations?${new URLSearchParams(
    Object.entries(parameters).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )}`;
}
