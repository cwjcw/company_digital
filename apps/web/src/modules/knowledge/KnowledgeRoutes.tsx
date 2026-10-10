import { Alert, Space, Typography } from "antd";
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { KnowledgeCapabilities } from "@kdos/contracts";
import { hasResourcePermission } from "../../shared/KdosDataTable";
import { KnowledgeManagement } from "./KnowledgePages";
import { KnowledgeHome, KnowledgeQueryState, KnowledgeReader, KnowledgeSpaceBrowse } from "./KnowledgePortal";

import { useKnowledgeCapabilities } from "./knowledge-portal";

function ManagementGate({ section = "pages" }: { section?: "home" | "pages" | "spaces" | "archive" | "trash" }) {
  const capabilities = useKnowledgeCapabilities(), location = useLocation();
  const c = capabilities.data;
  if (capabilities.isPending || capabilities.error) return <KnowledgeQueryState loading={capabilities.isPending} error={capabilities.error} retry={capabilities.refetch} />;
  const pages = !!c && (c.canCreatePages || c.canEditPages || c.canManagePages);
  const permitted = !!c && (section === "home" ? c.canManage : section === "pages" ? pages : section === "spaces" ? c.canCreateSpaces || c.canManageSpaces : section === "archive" ? c.canArchive : c.canTrash);
  if (!permitted) return <><Link to="/knowledge">返回知识库</Link><Alert type="warning" message="当前权限不能进入此知识管理区域" /></>;
  if (section === "home" && !pages) return <Navigate replace to={`/knowledge/manage/${c!.canCreateSpaces || c!.canManageSpaces ? "spaces" : c!.canArchive ? "archive" : "trash"}`} />;
  return <div className="knowledge-management"><nav className="knowledge-management-nav"><Typography.Title level={2}>知识管理</Typography.Title><Space wrap>
    <Link to="/knowledge">返回知识库</Link>{pages && <Link aria-current={location.pathname === "/knowledge/manage" ? "page" : undefined} to="/knowledge/manage">页面与文件</Link>}
    {(c!.canCreateSpaces || c!.canManageSpaces) && <Link to="/knowledge/manage/spaces">空间管理</Link>}
    {c!.canArchive && <Link to="/knowledge/manage/archive">归档管理</Link>}{c!.canTrash && <Link to="/knowledge/manage/trash">回收站</Link>}
  </Space></nav><KnowledgeManagement capabilities={c!} /></div>;
}
function LegacyPage() {
  const { id } = useParams(), [params] = useSearchParams();
  const capabilities = useKnowledgeCapabilities();
  const working = params.get("mode") === "working" || params.get("edit") === "1";
  if (!working) return <KnowledgeReader />;
  if (capabilities.isPending || capabilities.error) return <KnowledgeQueryState loading={capabilities.isPending} error={capabilities.error} retry={capabilities.refetch} />;
  const c: KnowledgeCapabilities | undefined = capabilities.data;
  return c && (c.canEditPages || c.canManagePages) ? <Navigate replace to={`/knowledge/manage/pages/${id}?${params}`} /> : <><Link to="/knowledge">返回知识库</Link><Alert type="warning" message="当前权限不能查看或编辑工作草稿" /></>;
}
export function KnowledgeRoutes() {
  if (!hasResourcePermission("knowledge-pages", "read") || !hasResourcePermission("knowledge-spaces", "read")) return <Alert type="warning" message="当前权限组不能查看知识库" />;
  return <Routes>
    <Route index element={<KnowledgeHome />} />
    <Route path="spaces/:id" element={<KnowledgeSpaceBrowse />} />
    <Route path="pages/:id" element={<LegacyPage />} />
    <Route path="manage" element={<ManagementGate section="home" />} />
    <Route path="manage/pages" element={<ManagementGate />} />
    <Route path="manage/pages/:id" element={<ManagementGate />} />
    <Route path="manage/spaces" element={<ManagementGate section="spaces" />} />
    <Route path="manage/archive" element={<ManagementGate section="archive" />} />
    <Route path="manage/trash" element={<ManagementGate section="trash" />} />
    <Route path="settings" element={<Navigate replace to="/knowledge/manage/spaces" />} />
    <Route path="archive" element={<Navigate replace to="/knowledge/manage/archive" />} />
    <Route path="trash" element={<Navigate replace to="/knowledge/manage/trash" />} />
    <Route path="*" element={<Navigate replace to="/knowledge" />} />
  </Routes>;
}
