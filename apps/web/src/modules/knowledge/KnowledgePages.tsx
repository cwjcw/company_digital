import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Dropdown, Empty, Input, List, Pagination, Space, Spin, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { knowledgeStatusOptions, type KnowledgeArticle } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission, hasResourcePermission, KdosDataTable, TablePermissionButton } from "../../shared/KdosDataTable";
import { blankPlatformQuery, platformRowsUrl, type PlatformTablePage, type PlatformTableQuery } from "../../shared/platform-table";
import { formatAuditUser, useAuditIdentityDirectory } from "../../shared/audit-fields";
import { downloadApiFile } from "../../shared/legacy-ui";
import { KnowledgeCategories } from "./KnowledgeCategories";
import { KnowledgeContent } from "./KnowledgeContent";
import { useKnowledgeCategories, KnowledgeFileContext, knowledgeFileUrl } from "./knowledge-ui";
export { KnowledgeEditor } from "./KnowledgeEditor";

const canManage = () => ["create", "update", "delete"].some((action) => hasResourcePermission("knowledge-articles", action));
function KnowledgeActions() {
  const navigate = useNavigate();
  return <Space wrap>{hasResourcePermission("knowledge-articles", "create") && <Button type="primary" onClick={() => navigate("/knowledge/manage/articles/new")}>新建文章</Button>}{canManage() && hasResourcePermission("knowledge-articles", "read") && <Button onClick={() => navigate("/knowledge/manage/articles")}>文章管理</Button>}</Space>;
}
export function KnowledgeHome() {
  const navigate = useNavigate(); const [search, setSearch] = useState(""); const [categoryId, setCategoryId] = useState<string>(); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(100);
  const articles = useQuery({ queryKey: ["knowledge", "browse", search, categoryId, page, pageSize], queryFn: () => {
    const params = new URLSearchParams({ search, page: String(page), pageSize: String(pageSize) }); if (categoryId) params.set("categoryId", categoryId); return api<PlatformTablePage<KnowledgeArticle>>(`/knowledge/articles?${params}`);
  }, enabled: hasResourcePermission("knowledge-articles", "read"), retry: false });
  if (!hasResourcePermission("knowledge-articles", "read")) return <Space direction="vertical"><Alert type="warning" message="当前权限组没有知识文章查看权限" /><KnowledgeActions /></Space>;
  return <div className="knowledge-layout"><KnowledgeCategories selectedId={categoryId} onSelect={(id) => { setCategoryId(id); setPage(1); }} /><div>
    <Space wrap style={{ width: "100%", marginBottom: 16 }}><Input.Search className="knowledge-search" placeholder="搜索标题、摘要、正文和标签" aria-label="搜索知识" allowClear enterButton="搜索" onSearch={(value) => { setSearch(value); setPage(1); }} /><KnowledgeActions /></Space>
    {articles.error ? <Alert type="error" message={(articles.error as Error).message} /> : <List className="knowledge-article-list" loading={articles.isLoading} dataSource={articles.data?.rows ?? []} locale={{ emptyText: <Empty description="当前条件下暂无可见知识文章" /> }} renderItem={(row) => <List.Item>
      <div><h3><Button type="link" style={{ padding: 0, height: "auto", fontSize: 18 }} onClick={() => navigate(`/knowledge/articles/${row.id}`)}>{row.title ?? "知识文章"}</Button></h3>
        <Typography.Paragraph>{row.summary || row.snippet}</Typography.Paragraph>
        <Space wrap>{row.rootCategoryName && <Typography.Text type="secondary">{row.rootCategoryName}{row.categoryName !== row.rootCategoryName ? ` / ${row.categoryName}` : ""}</Typography.Text>}{row.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}<Typography.Text type="secondary">{row.publisherName} {row.publishedAt && dayjs(row.publishedAt).format("YYYY-MM-DD HH:mm")}</Typography.Text></Space>
      </div>
    </List.Item>} />}
    <Pagination total={articles.data?.total ?? 0} current={page} pageSize={pageSize} pageSizeOptions={[50, 100, 200, 500, 1000]} showSizeChanger onChange={(page, size) => { setPage(size === pageSize ? page : 1); setPageSize(size); }} style={{ marginTop: 16 }} />
  </div></div>;
}
export function KnowledgeReader() {
  const { id } = useParams(); const [params, setParams] = useSearchParams(); const { message } = App.useApp(); const navigate = useNavigate();
  const mode = params.get("mode") === "manage" ? "manage" as const : undefined; const version = params.has("version") ? Number(params.get("version")) : undefined;
  const [showHistory, setShowHistory] = useState(false);
  const article = useQuery({ queryKey: ["knowledge", "detail", id, mode, version], queryFn: () => api<KnowledgeArticle>(version ? `/knowledge/articles/${id}/versions/${version}` : `/knowledge/articles/${id}${mode ? "?mode=manage" : ""}`), retry: false, refetchOnWindowFocus: false, placeholderData: undefined });
  const versions = useQuery({ queryKey: ["knowledge", "versions", id], queryFn: () => api<{ publishedVersion: number; publishedAt: string }[]>(`/knowledge/articles/${id}/versions`), enabled: showHistory, retry: false });
  if (article.isLoading) return <Spin />; if (article.error) return <Alert type="error" message={(article.error as Error).message} />; const row = article.data; if (!row) return null;
  return <KnowledgeFileContext.Provider value={{ mode, version }}><article className="knowledge-reader">
    <Space wrap><Button onClick={() => navigate("/knowledge")}>返回知识库</Button>{canManage() && hasFieldPermission("knowledge-articles", "publishedVersion", "read") && <Button onClick={() => setShowHistory(!showHistory)}>历史版本</Button>}{hasResourcePermission("knowledge-articles", "update") && <Button onClick={() => navigate(`/knowledge/manage/articles/${id}/edit`)}>编辑工作副本</Button>}</Space>
    {showHistory && <div style={{ marginTop: 12 }}>{versions.error ? <Alert type="error" message={(versions.error as Error).message} /> : <Space wrap>{versions.data?.map((item) => <Button key={item.publishedVersion} onClick={() => setParams({ version: String(item.publishedVersion) })}>v{item.publishedVersion} · {dayjs(item.publishedAt).format("YYYY-MM-DD HH:mm")}</Button>)}<Button onClick={() => setParams({})}>当前发布版本</Button></Space>}</div>}
    {mode && !version && <Tag>工作副本预览</Tag>}<Typography.Title level={2}>{row.title}</Typography.Title>
    <Space wrap className="knowledge-meta"><span>{row.rootCategoryName}{row.categoryName !== row.rootCategoryName ? ` / ${row.categoryName ?? ""}` : ""}</span>{row.tags?.map((tag) => <Tag key={tag}>{tag}</Tag>)}<span>{row.publisherName}</span>{row.publishedAt && <span>{dayjs(row.publishedAt).format("YYYY-MM-DD HH:mm:ss")}</span>}{row.publishedVersion != null && <span>版本 v{row.publishedVersion}</span>}{row.viewCount != null && <span>浏览量 {row.viewCount}</span>}</Space>
    <KnowledgeContent content={row.content} />
    {row.attachments?.length ? <Space direction="vertical" style={{ marginTop: 20 }}><Typography.Text strong>附件</Typography.Text>{row.attachments.map((file) => <Button key={file.id} type="link" onClick={() => void downloadApiFile(knowledgeFileUrl(file.id, { mode, version }), file.originalName).catch((error: Error) => message.error(error.message))}>{file.originalName}</Button>)}</Space> : null}
  </article></KnowledgeFileContext.Provider>;
}
export function KnowledgeManagement() {
  const navigate = useNavigate(); const { message, modal } = App.useApp(); const client = useQueryClient(); const [query, setQuery] = useState<PlatformTableQuery>(blankPlatformQuery()); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const categories = useKnowledgeCategories(); const memberNames = useAuditIdentityDirectory();
  const articles = useQuery({ queryKey: ["knowledge", "manage", query], queryFn: () => api<PlatformTablePage<KnowledgeArticle>>(platformRowsUrl("knowledge-articles", query)), enabled: canManage() && hasResourcePermission("knowledge-articles", "read"), retry: false });
  const action = async (row: KnowledgeArticle, operation: "publish" | "disable") => {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { await api(`/knowledge/articles/${row.id}/${operation}`, { method: "POST", body: JSON.stringify({ expectedVersion: row.version }) }); await client.invalidateQueries({ queryKey: ["knowledge"] }); message.success(operation === "publish" ? "文章已发布" : "文章已停用"); }
    catch (error) { message.error((error as Error).message); throw error; } finally { lock.current = false; setBusy(false); }
  };
  if (!canManage() || !hasResourcePermission("knowledge-articles", "read")) return <Alert type="error" message="当前权限组没有文章管理权限" />;
  const fields = ["title", "summary", "categoryId", "content", "tags", "visibility", "attachmentIds"];
  const canPublish = hasResourcePermission("knowledge-articles", "update") && hasFieldPermission("knowledge-articles", "status", "update") && fields.every((field) => hasFieldPermission("knowledge-articles", field, "read"));
  return <div>{articles.error && <Alert type="error" message={(articles.error as Error).message} />}<KdosDataTable<KnowledgeArticle> resource="knowledge-articles" rowKey="id" dataSource={articles.data?.rows} loading={articles.isLoading} serverData={{ total: articles.data?.total ?? 0, onQueryChange: setQuery }} toolbar={<KnowledgeActions />} deleteAction={{ permitted: hasResourcePermission("knowledge-articles", "delete"), canDelete: (row) => row.status === "DRAFT" && !row.publishedVersion, confirmContent: "仅删除从未发布的草稿；附件保留为私有审计资料。", onDelete: async (rows) => { for (const row of rows) await api(`/knowledge/articles/${row.id}`, { method: "DELETE", body: JSON.stringify({ expectedVersion: row.version }) }); await client.invalidateQueries({ queryKey: ["knowledge"] }); } }} columns={[
    { title: "标题", dataIndex: "title", width: 320, render: (title: string, row) => <Space><Button type="link" onClick={() => navigate(`/knowledge/articles/${row.id}?mode=manage`)}>{title}</Button><Dropdown menu={{ items: [
      ...(hasResourcePermission("knowledge-articles", "update") ? [{ key: "edit", label: "编辑工作副本", onClick: () => navigate(`/knowledge/manage/articles/${row.id}/edit`) }] : []),
      ...(canPublish ? [{ key: "publish", label: row.publishedVersion ? "重新发布" : "发布", disabled: busy, onClick: () => modal.confirm({ title: row.publishedVersion ? "重新发布工作副本？" : "发布文章？", onOk: () => action(row, "publish") }) }] : []),
      ...(row.status === "PUBLISHED" && hasResourcePermission("knowledge-articles", "update") && hasFieldPermission("knowledge-articles", "status", "update") ? [{ key: "disable", label: "停用", danger: true, disabled: busy, onClick: () => modal.confirm({ title: "停用此文章？", onOk: () => action(row, "disable") }) }] : [])
    ] }}><Button type="text" size="small" icon={<MoreOutlined />} aria-label="文章更多操作" /></Dropdown></Space> },
    { title: "摘要", dataIndex: "summary", width: 250, ellipsis: true },
    { title: "分类", dataIndex: "categoryId", width: 160, render: (id) => categories.data?.find((node) => node.id === id)?.name ?? "" },
    { title: "标签", dataIndex: "tags", width: 180, render: (tags?: string[]) => tags?.map((tag) => <Tag key={tag}>{tag}</Tag>) },
    { title: "状态", dataIndex: "status", width: 100, render: (status) => knowledgeStatusOptions.find((option) => option.value === status)?.label },
    { title: "工作修订", dataIndex: "workingRevision", width: 90 }, { title: "发布版本", dataIndex: "publishedVersion", width: 90 },
    { title: "发布人", dataIndex: "publishedBy", width: 140, render: (value) => value ? formatAuditUser(value, memberNames) : "" }, { title: "发布时间", dataIndex: "publishedAt", width: 160, render: (value) => value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "" },
    { title: "浏览量", dataIndex: "viewCount", width: 90 }
  ]} scroll={{ x: "max-content" }} /></div>;
}
export function KnowledgeCategoryManagement() { return <><TablePermissionButton resource="knowledge-categories" /><KnowledgeCategories /></>; }
