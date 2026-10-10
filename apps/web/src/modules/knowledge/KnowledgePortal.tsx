import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App, Breadcrumb, Button, Card, Empty, Input, List, Pagination, Skeleton, Space, Tag, Typography } from "antd";
import { HomeOutlined, SearchOutlined } from "@ant-design/icons";
import { Link, useParams, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import type { KnowledgeContentNode, KnowledgePage, KnowledgePageResult, KnowledgeSpace } from "@kdos/contracts";
import { api } from "../../api";
import { hasFieldPermission } from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import { KnowledgePageTree } from "./KnowledgePageTree";
import { KnowledgeSpaceIcon } from "./KnowledgeSpaceIcon";
import { KnowledgeContent } from "./KnowledgeContent";
import { KnowledgeFilePreview } from "./KnowledgeFilePreview";
import { KnowledgeFileContext, knowledgeFileUrl } from "./knowledge-ui";
import { knowledgeFileType, useKnowledgeCapabilities } from "./knowledge-portal";
import "./knowledge.css";

export function KnowledgeQueryState({ loading, error, retry }: { loading: boolean; error: Error | null; retry: () => unknown }) {
  return loading ? <Skeleton active /> : error ? <Alert showIcon type="error" message={error.message} action={<Button onClick={() => void retry()}>重试</Button>} /> : null;
}
export function KnowledgePortalHeader() {
  const capabilities = useKnowledgeCapabilities();
  return <nav className="knowledge-portal-nav" aria-label="知识库导航">
    <Link to="/knowledge"><HomeOutlined /> 凯南知识库</Link>
    <Space wrap><Link to="/">返回工作台</Link>{capabilities.data?.canManage && <Link to="/knowledge/manage">进入知识管理</Link>}</Space>
  </nav>;
}
function KnowledgeResultList({ result, pageSize, onPage }: { result?: KnowledgePageResult; pageSize: number; onPage: (page: number) => void }) {
  return <><List dataSource={result?.rows ?? []} locale={{ emptyText: <Empty description="暂无可见知识" /> }}
    renderItem={(row) => <List.Item key={row.id}>
      <div className="knowledge-result-item">
        <Link className="knowledge-result-title" to={`/knowledge/pages/${row.id}`}>{row.title || "知识阅读"}</Link>
        <Space wrap>{row.spaceName && <span>{row.spaceName}</span>}{knowledgeFileType(row) && <Tag>{knowledgeFileType(row)}</Tag>}
          {row.publishedAt && <span>发布时间：{dayjs(row.publishedAt).format("YYYY-MM-DD HH:mm")}</span>}</Space>
        {row.breadcrumb && <div className="knowledge-result-path">{row.breadcrumb.map((b) => b.title).join(" > ")}</div>}
        {(row.description || row.snippet) && <Typography.Paragraph ellipsis={{ rows: 2 }}>{row.description || row.snippet}</Typography.Paragraph>}
      </div>
    </List.Item>} />
    {result && result.total > pageSize && <Pagination current={result.page} pageSize={pageSize} total={result.total} showSizeChanger={false} onChange={onPage} />}
  </>;
}
function useSpaces() {
  return useQuery({ queryKey: ["knowledge", "spaces"], queryFn: () => api<KnowledgeSpace[]>("/knowledge/spaces") });
}
function SearchBox({ value, onSearch, scoped = false }: { value: string; onSearch: (value: string) => void; scoped?: boolean }) {
  return <div className="knowledge-portal-search"><Input.Search key={value} defaultValue={value} allowClear size="large" aria-label={scoped ? "搜索当前空间知识" : "搜索知识"}
    placeholder={scoped ? "搜索当前空间的已发布知识" : "搜索标题、文件名、说明、标签、路径或在线文章正文"}
    enterButton={<><SearchOutlined /> 搜索</>} onSearch={(text) => onSearch(text.trim())} />
    <Typography.Text type="secondary">搜索已发布知识；文件内容以在线预览为准。</Typography.Text></div>;
}
export function KnowledgeHome() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "", page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = search ? 20 : 10;
  const spaces = useSpaces();
  const pages = useQuery({ queryKey: ["knowledge", "portal", search, page], queryFn: () => api<KnowledgePageResult>(
    `${search ? "/knowledge/search" : "/knowledge/pages"}?${new URLSearchParams({ mode: "published", page: String(page), pageSize: String(pageSize), ...(search ? { search } : hasFieldPermission("knowledge-pages", "publishedAt", "read") ? { sortField: "publishedAt", sortOrder: "desc" } : {}) })}`) });
  return <div className="knowledge-portal"><KnowledgePortalHeader />
    <header className="knowledge-portal-hero"><Typography.Title level={1}>凯南知识库</Typography.Title><Typography.Paragraph>公司制度、操作规范、培训资料与业务知识，一站式查阅。</Typography.Paragraph>
      <SearchBox value={search} onSearch={(text) => setParams(text ? { search: text } : {})} /></header>
    {search ? <section><Space><Typography.Title level={2}>搜索结果</Typography.Title><Button onClick={() => setParams({})}>返回首页</Button></Space>
      <KnowledgeQueryState loading={pages.isPending} error={pages.error} retry={pages.refetch} />{pages.data && <KnowledgeResultList result={pages.data} pageSize={pageSize} onPage={(n) => setParams({ search, page: String(n) })} />}
    </section> : <><section><Typography.Title level={2}>知识空间</Typography.Title>
      <KnowledgeQueryState loading={spaces.isPending} error={spaces.error} retry={spaces.refetch} />
      {spaces.data && (spaces.data.length ? <div className="knowledge-space-cards">{spaces.data.map((space) => <Link key={space.id} to={`/knowledge/spaces/${space.id}`}>
        <Card hoverable><div className="knowledge-space-card-icon"><KnowledgeSpaceIcon value={space.icon} /></div><Typography.Title level={3}>{space.name || "知识空间"}</Typography.Title>{space.description && <Typography.Paragraph>{space.description}</Typography.Paragraph>}</Card>
      </Link>)}</div> : <Empty description="暂无可查看的知识空间" />)}
    </section><section><Typography.Title level={2}>最近更新</Typography.Title>
      <KnowledgeQueryState loading={pages.isPending} error={pages.error} retry={pages.refetch} />
      {pages.data && <KnowledgeResultList result={pages.data} pageSize={10} onPage={(n) => setParams({ page: String(n) })} />}
      {page === 1 && (pages.data?.total ?? 0) > 10 && <Button onClick={() => setParams({ page: "2" })}>查看更多</Button>}
    </section></>}
  </div>;
}
export function KnowledgeSpaceBrowse() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const parentId = params.get("parentId") ?? "", search = params.get("search") ?? "", page = Math.max(1, Number(params.get("page")) || 1);
  const spaces = useSpaces(), space = spaces.data?.find((s) => s.id === id);
  const parent = useQuery({ queryKey: ["knowledge", "portal-parent", parentId], queryFn: () => api<KnowledgePage>(`/knowledge/pages/${parentId}?mode=published`), enabled: !!parentId && !!space });
  const pages = useQuery({ queryKey: ["knowledge", "portal-space", id, parentId, search, page], enabled: !!space && (!parentId || !!parent.data),
    queryFn: () => api<KnowledgePageResult>(`${search ? "/knowledge/search" : `/knowledge/spaces/${id}/tree`}?${new URLSearchParams({ mode: "published", spaceId: id!, page: String(page), pageSize: "20", ...(search ? { search } : parentId ? { parentId } : {}) })}`) });
  const onOpen = useCallback((row: KnowledgePage) => setParams({ parentId: row.id }), [setParams]);
  if (spaces.isPending || spaces.error) return <div className="knowledge-portal"><KnowledgePortalHeader /><KnowledgeQueryState loading={spaces.isPending} error={spaces.error} retry={spaces.refetch} /></div>;
  if (parent.data && parent.data.spaceId !== id) return <div className="knowledge-portal"><KnowledgePortalHeader /><Alert type="warning" message="该分类不属于当前知识空间" /></div>;
  if (!space) return <div className="knowledge-portal"><KnowledgePortalHeader /><Alert type="warning" message="空间不存在或无查看权限" /></div>;
  return <div className="knowledge-portal"><KnowledgePortalHeader /><Typography.Title level={1}><KnowledgeSpaceIcon value={space.icon} /> {space.name}</Typography.Title>
    <SearchBox scoped value={search} onSearch={(text) => setParams({ ...(parentId ? { parentId } : {}), ...(text ? { search: text } : {}) })} />
    <div className="knowledge-space-layout"><aside className="knowledge-directory"><Typography.Title level={3}>知识目录</Typography.Title>
      <Button onClick={() => setParams({})}>空间根目录</Button><KnowledgePageTree space={space} working={false} refresh={0} onOpen={onOpen} /></aside>
      <main><Breadcrumb items={[{ title: <Link to="/knowledge">知识库</Link> }, { title: <Button type="link" onClick={() => setParams({})}>{space.name}</Button> },
        ...(parent.data?.breadcrumb?.slice(1) ?? []).map((b) => ({ title: <Button type="link" onClick={() => setParams({ parentId: b.id })}>{b.title}</Button> }))]} />
        <KnowledgeQueryState loading={!!parentId && parent.isPending} error={parent.error} retry={parent.refetch} />
        <Typography.Title level={2}>{search ? "搜索结果" : parent.data?.title || "空间根目录"}</Typography.Title>
        {parent.data && !search && <Space wrap><Link to={`/knowledge/pages/${parentId}`}>阅读当前知识</Link><Button onClick={() => setParams(parent.data?.parentId ? { parentId: parent.data.parentId } : {})}>返回上级目录</Button></Space>}
        {(!parentId || parent.data) && <><KnowledgeQueryState loading={pages.isPending} error={pages.error} retry={pages.refetch} />
          {pages.data && <><KnowledgeResultList result={pages.data} pageSize={20} onPage={(n) => setParams({ ...(parentId ? { parentId } : {}), ...(search ? { search } : {}), page: String(n) })} />
            {!search && pages.data.rows.filter((row) => row.hasChildren).map((row) => <Button key={row.id} onClick={() => onOpen(row)}>进入目录：{row.title}</Button>)}</>}
        </>}
      </main></div>
  </div>;
}
function headings(content?: KnowledgeContentNode) {
  const result: string[] = [];
  const visit = (node: KnowledgeContentNode) => { if (node.type === "heading") result.push((node.content ?? []).map((c) => c.text ?? "").join("")); node.content?.forEach(visit); };
  if (content) visit(content);
  return result;
}
export function KnowledgeReader() {
  const { id } = useParams(), [params] = useSearchParams(), versionId = params.get("versionId") ?? undefined;
  const { message } = App.useApp();
  const page = useQuery({ queryKey: ["knowledge", "portal-read", id, versionId], queryFn: () => api<KnowledgePage>(`/knowledge/pages/${id}?${new URLSearchParams({ mode: "published", ...(versionId ? { versionId } : {}) })}`), staleTime: 0 });
  const row = page.data, scope = { mode: "published" as const, versionId };
  const toc = headings(row?.content);
  return <div className="knowledge-portal"><KnowledgePortalHeader /><KnowledgeQueryState loading={page.isPending} error={page.error} retry={page.refetch} />
    {row && <KnowledgeFileContext.Provider value={scope}><article className="knowledge-employee-reader">
      <Breadcrumb items={[{ title: <Link to="/knowledge">知识库</Link> }, ...(row.breadcrumb ?? []).map((b, index) => ({ title: index === 0
        ? <Link to={`/knowledge/spaces/${row.spaceId}`}>{b.title}</Link> : <Link to={`/knowledge/spaces/${row.spaceId}?parentId=${b.id}`}>{b.title}</Link> }))]} />
      <Typography.Title level={1}>{row.title}</Typography.Title><Space wrap>{knowledgeFileType(row) && <Tag>{knowledgeFileType(row)}</Tag>}
        {row.publishedAt && <span>发布时间：{dayjs(row.publishedAt).format("YYYY-MM-DD HH:mm")}</span>}{versionId && <Tag>历史发布版本</Tag>}</Space>
      <div className={`knowledge-reading-grid${toc.length ? "" : " knowledge-reading-full"}`}><div>
        {row.contentMode === "FILE" ? row.primaryFile ? <KnowledgeFilePreview file={row.primaryFile} scope={scope} /> : <Alert type="info" message="当前权限范围内暂无可预览文件" /> : <KnowledgeContent content={row.content} />}
        {row.description && <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>{row.description}</Typography.Paragraph>}
        {!!row.attachments?.filter((file) => file.role !== "PRIMARY").length && <Typography.Title level={3}>补充附件</Typography.Title>}
        {row.attachments?.filter((file) => file.role !== "PRIMARY").map((file) => <div key={file.id}><Button type="link" onClick={() => void downloadApiFile(knowledgeFileUrl(file.id, scope), file.originalName).catch((e) => message.error((e as Error).message))}>{file.originalName}</Button></div>)}
      </div>{!!toc.length && <aside className="knowledge-toc"><strong>目录</strong>{toc.map((title, index) => <a key={index} href={`#knowledge-heading-${index}`}>{title}</a>)}</aside>}</div>
      <footer><Space wrap><Link to="/knowledge">返回知识首页</Link>{row.spaceId && <Link to={`/knowledge/spaces/${row.spaceId}${row.parentId ? `?parentId=${row.parentId}` : ""}`}>返回分类{row.spaceName ? `：${row.spaceName}` : ""}</Link>}</Space></footer>
    </article></KnowledgeFileContext.Provider>}
  </div>;
}
