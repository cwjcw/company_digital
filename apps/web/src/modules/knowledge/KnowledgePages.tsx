import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Pagination,
  Select,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import dayjs from "dayjs";
import type {
  KnowledgeContentNode,
  KnowledgePage,
  KnowledgeSpace,
} from "@kdos/contracts";
import { api } from "../../api";
import {
  hasFieldPermission,
  hasResourcePermission,
  KdosDataTable,
} from "../../shared/KdosDataTable";
import { downloadApiFile } from "../../shared/legacy-ui";
import {
  blankPlatformQuery,
  type PlatformTableQuery,
} from "../../shared/platform-table";
import { KnowledgeContent } from "./KnowledgeContent";
import { KnowledgeFilePreview } from "./KnowledgeFilePreview";
import {
  KnowledgeFileUpload,
  type CreatedKnowledgeFile,
} from "./KnowledgeFileUpload";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { canPublishKnowledge } from "./knowledge-publish";
import { KnowledgeAccess } from "./KnowledgeAccess";
import { KnowledgeImport } from "./KnowledgeImport";
import {
  KnowledgeLocationPicker,
  type KnowledgeLocationValue,
} from "./KnowledgeLocationPicker";
import { KnowledgeSpaceIcon } from "./KnowledgeSpaceIcon";
import { KnowledgeSettings } from "./KnowledgeSettings";
import {
  KnowledgeFileContext,
  knowledgeFileUrl,
  knowledgeCanRetry,
  copyKnowledgeLink,
} from "./knowledge-ui";
import type { KnowledgeDraftSession } from "./knowledge-autosave";
import "./knowledge.css";
type PageResult = {
  rows: KnowledgePage[];
  total: number;
  page: number;
  pageSize: number;
};
const readable = (field: string) =>
  hasFieldPermission("knowledge-pages", field, "read");
const appendTree = (
  old: DataNode[],
  parent: string | undefined,
  more: DataNode[],
): DataNode[] =>
  parent
    ? old.map((n) =>
        String(n.key) === parent
          ? {
              ...n,
              children: [
                ...(n.children ?? []).filter(
                  (c) => !String(c.key).startsWith("more:"),
                ),
                ...more,
              ],
            }
          : {
              ...n,
              ...(n.children
                ? { children: appendTree(n.children, parent, more) }
                : {}),
            },
      )
    : [...old.filter((n) => !String(n.key).startsWith("more:")), ...more];
function PageTree({
  space,
  working,
  refresh,
  onOpen,
}: {
  space: KnowledgeSpace;
  working: boolean;
  refresh: number;
  onOpen: (page: KnowledgePage) => void;
}) {
  const [nodes, setNodes] = useState<DataNode[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = useCallback(
    async (parentId?: string, page = 1): Promise<DataNode[]> => {
      const p = new URLSearchParams({
        mode: working ? "working" : "published",
        pageSize: "100",
        page: String(page),
      });
      if (parentId) p.set("parentId", parentId);
      const result = await api<PageResult>(
        `/knowledge/spaces/${space.id}/tree?${p}`,
      );
      const rows: DataNode[] = result.rows.map((row) => ({
        key: row.id,
        isLeaf: !row.hasChildren,
        title: (
          <button className="knowledge-tree-link" onClick={() => onOpen(row)}>
            {row.title}
            {row.status === "DRAFT" && <Tag>草稿</Tag>}
          </button>
        ),
      }));
      if (page * 100 < result.total)
        rows.push({
          key: `more:${parentId ?? "root"}:${page}`,
          isLeaf: true,
          title: (
            <Button
              size="small"
              onClick={() =>
                void load(parentId, page + 1).then((more) =>
                  setNodes((old) => appendTree(old, parentId, more)),
                )
              }
            >
              加载更多
            </Button>
          ),
        });
      return rows;
    },
    [space.id, working, onOpen],
  );
  useEffect(() => {
    const current = ++generation.current;
    setNodes([]);
    setBusy(true);
    setError("");
    void load()
      .then((rows) => {
        if (current === generation.current) setNodes(rows);
      })
      .catch((e) => {
        if (current === generation.current) setError((e as Error).message);
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
  }, [load, refresh]);
  return error ? (
    <Alert type="error" message={error} />
  ) : busy ? (
    <Spin />
  ) : (
    <Tree
      blockNode
      treeData={nodes}
      loadData={async (node) => {
        if (String(node.key).startsWith("more:")) return;
        try {
          const children = await load(String(node.key));
          setNodes((old) => appendTree(old, String(node.key), children));
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    />
  );
}
function toc(content?: KnowledgeContentNode) {
  const items: { title: string; index: number }[] = [];
  let index = 0;
  const walk = (n: KnowledgeContentNode) => {
    if (n.type === "heading")
      items.push({
        title: (n.content ?? []).map((c) => c.text ?? "").join(""),
        index: index++,
      });
    for (const c of n.content ?? []) walk(c);
  };
  if (content) walk(content);
  return items;
}
export function KnowledgeWiki() {
  const { id } = useParams(),
    location = useLocation(),
    navigate = useNavigate(),
    [params, setParams] = useSearchParams();
  const { message, modal } = App.useApp(),
    client = useQueryClient();
  const [spaceId, setSpaceId] = useState<string>(),
    [refresh, setRefresh] = useState(0),
    [creating, setCreating] = useState<KnowledgeLocationValue>(),
    [validCreation, setValidCreation] = useState(false),
    [validMove, setValidMove] = useState(false),
    [importing, setImporting] = useState(false),
    [fileUploading, setFileUploading] = useState(false),
    [createdFiles, setCreatedFiles] = useState<CreatedKnowledgeFile[]>([]),
    [uploadResults, setUploadResults] = useState(false),
    [accessing, setAccessing] = useState(false),
    [history, setHistory] = useState(false),
    [moving, setMoving] = useState(false),
    [destination, setDestination] = useState<string>(),
    [parent, setParent] = useState<string>(),
    [sort, setSort] = useState("0"),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [searchPage, setSearchPage] = useState(1),
    [tag, setTag] = useState(""),
    [showWorking, setShowWorking] = useState(false);
  const draft = useRef<KnowledgeDraftSession | null>(null);
  const publishing = useRef(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState("");
  const onSession = useCallback((s: KnowledgeDraftSession | null) => {
    draft.current = s;
  }, []);
  const editing = params.get("edit") === "1",
    mode =
      params.get("mode") === "working" || editing ? "working" : "published",
    versionId = params.get("versionId") ?? undefined;
  useEffect(() => {
    if (editing) setShowWorking(true);
  }, [editing]);
  const spaces = useQuery({
    queryKey: ["knowledge", "spaces"],
    queryFn: () => api<KnowledgeSpace[]>("/knowledge/spaces"),
    enabled: hasResourcePermission("knowledge-spaces", "read"),
    retry: false,
  });
  const page = useQuery({
    queryKey: ["knowledge", "page", id, mode, versionId],
    queryFn: () =>
      api<KnowledgePage>(
        `/knowledge/pages/${id}?${new URLSearchParams({ mode, ...(versionId ? { versionId } : {}) })}`,
      ),
    enabled: Boolean(id && hasResourcePermission("knowledge-pages", "read")),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(() => setPublishError(""), [id, mode, versionId]);
  useEffect(() => {
    if (page.data?.spaceId) setSpaceId(page.data.spaceId);
    else if (!spaceId && spaces.data?.length) setSpaceId(spaces.data[0]!.id);
  }, [page.data?.spaceId, spaces.data, spaceId]);
  const selected = spaces.data?.find((s) => s.id === spaceId),
    row = page.data;
  const versions = useQuery({
    queryKey: ["knowledge", "versions", id, mode],
    queryFn: () =>
      api<
        {
          id: string;
          publishedVersion: number;
          title: string;
          publisherName: string;
          publishedAt: string;
        }[]
      >(`/knowledge/pages/${id}/versions?mode=${mode}`),
    enabled: Boolean(id && history),
    retry: false,
  });
  const results = useQuery({
    queryKey: ["knowledge", "search", spaceId, search, tag, searchPage],
    queryFn: () =>
      api<PageResult>(
        `/knowledge/search?${new URLSearchParams({ search, tag, page: String(searchPage), pageSize: "20", ...(spaceId ? { spaceId } : {}) })}`,
      ),
    enabled: Boolean(search),
    retry: false,
  });
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["knowledge"] });
    setRefresh((n) => n + 1);
  };
  const publishFromReader = async () => {
    if (!id || !row || versionId || publishing.current || !canPublishKnowledge(row)) return;
    publishing.current = true;
    setPublishBusy(true);
    setPublishError("");
    try {
      // A reader has no local edits to drain. Always obtain the working version
      // directly from the server; the displayed publication/cache is not a lock.
      const latest = await api<KnowledgePage>(`/knowledge/pages/${id}?mode=working`, { cache: "no-store" });
      if (!canPublishKnowledge(latest)) throw new Error("当前没有此页面的发布权限");
      if (latest.hasUnpublishedChanges === undefined) throw new Error("无法确认最新草稿的发布状态，请刷新后重试");
      if (!latest.hasUnpublishedChanges) {
        message.info("没有未发布修改");
        invalidate();
        return;
      }
      await api(`/knowledge/pages/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: latest.version }),
      });
      invalidate();
      setParams({});
      message.success("页面已发布");
    } catch (e) {
      const reason = (e as Error).message;
      setPublishError(reason);
      message.error(reason);
    } finally {
      publishing.current = false;
      setPublishBusy(false);
    }
  };
  const safely = useCallback(
    async (work: () => void) => {
      try {
        if (draft.current?.isOperating()) {
          message.info("文件或页面操作正在进行，请稍后切换");
          return;
        }
        await draft.current?.flush();
        work();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [message],
  );
  const open = useCallback(
    (p: KnowledgePage) => {
      void safely(() => {
        setSearch("");
        setHistory(false);
        navigate(
          `/knowledge/pages/${p.id}${p.status === "DRAFT" ? "?mode=working" : ""}`,
        );
      });
    },
    [navigate, safely],
  );
  const beginCreate = (parentId?: string) => {
    if (selected) setCreating({ spaceId: selected.id, parentId });
  };
  const create = async () => {
    if (!creating || !validCreation || busy) return;
    setBusy(true);
    try {
      await draft.current?.flush();
      const p = await api<{ id: string }>("/knowledge/pages", {
        method: "POST",
        body: JSON.stringify({
          spaceId: creating.spaceId,
          parentId: creating.parentId ?? null,
        }),
      });
      setCreating(undefined);
      invalidate();
      setShowWorking(true);
      navigate(`/knowledge/pages/${p.id}?edit=1`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const operation = async (
    kind: "archive" | "trash" | "restore" | "permanent",
  ) => {
    if (!row || busy) return;
    setBusy(true);
    try {
      await draft.current?.flush();
      await api(
        `/knowledge/pages/${row.id}${kind === "trash" ? "" : `/${kind}`}`,
        {
          method: kind === "trash" || kind === "permanent" ? "DELETE" : "POST",
          body: JSON.stringify({
            expectedVersion: draft.current?.version ?? row.version,
          }),
        },
      );
      invalidate();
      navigate("/knowledge");
      message.success("操作成功");
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = async () => {
    if (!row || !validMove || busy) return;
    setBusy(true);
    try {
      await api(`/knowledge/pages/${row.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          spaceId: destination,
          parentId: parent ?? null,
          sortOrder: Number(sort),
          expectedVersion: row.version,
        }),
      });
      setMoving(false);
      invalidate();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (
    !hasResourcePermission("knowledge-spaces", "read") ||
    !hasResourcePermission("knowledge-pages", "read")
  )
    return (
      <Alert type="warning" message="当前权限组没有知识空间 / 页面查看权限" />
    );
  const menu = row
    ? [
        ...(selected?.canCreate &&
        hasResourcePermission("knowledge-pages", "create")
          ? [
              {
                key: "child",
                label: "新建子页面",
                onClick: () => void safely(() => beginCreate(row.id)),
              },
            ]
          : []),
        ...(row.canEdit &&
        hasFieldPermission("knowledge-pages", "parentId", "update")
          ? [
              {
                key: "move",
                label: "移动 / 调整顺序",
                onClick: () => {
                  setDestination(row.spaceId);
                  setParent(row.parentId ?? undefined);
                  setSort(String(row.sortOrder));
                  setMoving(true);
                },
              },
            ]
          : []),
        ...(readable("publishedVersion")
          ? [
              {
                key: "history",
                label: "历史版本",
                onClick: () => setHistory(true),
              },
            ]
          : []),
        ...(row.canManage &&
        hasFieldPermission("knowledge-pages", "access", "update") &&
        readable("access")
          ? [
              {
                key: "access",
                label: "页面权限",
                onClick: () => setAccessing(true),
              },
            ]
          : []),
        ...(row.canManage &&
        hasFieldPermission("knowledge-pages", "status", "update") &&
        row.status === "PUBLISHED"
          ? [
              {
                key: "archive",
                label: "归档子树",
                onClick: () =>
                  modal.confirm({
                    title: "归档页面及全部子页面？",
                    onOk: () => operation("archive"),
                  }),
              },
            ]
          : []),
        ...(row.canManage && hasResourcePermission("knowledge-pages", "delete")
          ? [
              {
                key: "trash",
                label: "移到回收站",
                danger: true,
                onClick: () =>
                  modal.confirm({
                    title: "页面及子页面移入回收站？",
                    onOk: () => operation("trash"),
                  }),
              },
            ]
          : []),
        ...(row.contentMode !== "FILE" &&
        hasResourcePermission("knowledge-pages", "export")
          ? [
              {
                key: "md",
                label: "导出 Markdown",
                onClick: () =>
                  void downloadApiFile(
                    `/knowledge/pages/${row.id}/export?format=md&mode=${mode}${versionId ? `&versionId=${versionId}` : ""}`,
                    `knowledge_page_${row.id}.md`,
                  ).catch((e) => message.error((e as Error).message)),
              },
              {
                key: "html",
                label: "导出 HTML",
                onClick: () =>
                  void downloadApiFile(
                    `/knowledge/pages/${row.id}/export?format=html&mode=${mode}${versionId ? `&versionId=${versionId}` : ""}`,
                    `knowledge_page_${row.id}.html`,
                  ).catch((e) => message.error((e as Error).message)),
              },
            ]
          : []),
        {
          key: "link",
          label: "复制链接",
          onClick: () =>
            void copyKnowledgeLink(row.id)
              .then(() => message.success("链接已复制"))
              .catch(() => message.error("复制失败，请复制浏览器地址")),
        },
      ]
    : [];
  let body: ReactNode;
  if (location.pathname === "/knowledge/settings") body = <KnowledgeSettings />;
  else if (location.pathname === "/knowledge/archive")
    body = <KnowledgeTrash archived onRefresh={invalidate} />;
  else if (location.pathname === "/knowledge/trash")
    body = <KnowledgeTrash onRefresh={invalidate} />;
  else if (search)
    body = (
      <>
        <Typography.Title level={3}>搜索已发布页面</Typography.Title>
        <Input
          placeholder="标签（可选）"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setSearchPage(1);
          }}
          style={{ width: 220 }}
        />
        {results.error && (
          <Alert type="error" message={(results.error as Error).message} />
        )}
        <List
          loading={results.isLoading}
          dataSource={results.data?.rows}
          renderItem={(p) => (
            <List.Item>
              <div>
                <Button type="link" onClick={() => open(p)}>
                  {p.title}
                </Button>
                <div>{p.snippet}</div>
                <Space wrap>
                  {p.breadcrumb?.map((b) => b.title).join(" / ")}
                  {p.tags?.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {p.publisherName}
                  <span>
                    {p.publishedAt &&
                      dayjs(p.publishedAt).format("YYYY-MM-DD HH:mm")}
                  </span>
                </Space>
              </div>
            </List.Item>
          )}
        />
        <Pagination
          current={searchPage}
          pageSize={20}
          total={results.data?.total ?? 0}
          onChange={setSearchPage}
        />
      </>
    );
  // A cached working row can predate uploads/publication. Mount a new draft
  // session only after its entry refetch; keep an existing session during refetch.
  else if (
    id &&
    (page.isLoading || (editing && page.isFetching && !draft.current))
  )
    body = <Spin />;
  else if (page.error)
    body = <Alert type="error" message={(page.error as Error).message} />;
  else if (row && editing && row.canEdit)
    body = (
      <KnowledgeEditor
        key={row.id}
        page={row}
        onSession={onSession}
        onClose={() => {
          invalidate();
          setParams(row.status === "DRAFT" ? { mode: "working" } : {});
        }}
        onPublished={() => {
          invalidate();
          setParams({});
        }}
      />
    );
  else if (row)
    body = (
      <KnowledgeFileContext.Provider value={{ mode, versionId }}>
        <article className="knowledge-reader">
          <Space style={{ display: "flex", justifyContent: "space-between" }}>
            <Breadcrumb
              items={row.breadcrumb?.map((b, i) => ({
                title:
                  i === 0 ? (
                    <span>{b.title}</span>
                  ) : (
                    <Button
                      type="link"
                      onClick={() =>
                        navigate(
                          `/knowledge/pages/${b.id}${mode === "working" ? "?mode=working" : ""}`,
                        )
                      }
                    >
                      {b.title}
                    </Button>
                  ),
              }))}
            />
            <Space>
              {row.canEdit && hasResourcePermission("knowledge-pages", "update") && (
                <Button aria-label="编辑" disabled={publishBusy} onClick={() => setParams({ edit: "1" })}>编辑</Button>
              )}
              {!versionId && canPublishKnowledge(row) && row.hasUnpublishedChanges === true && (
                <Button aria-label={row.status === "PUBLISHED" ? "发布新版本" : "发布"} type="primary" loading={publishBusy} onClick={() => void publishFromReader()}>
                  {row.status === "PUBLISHED" ? "发布新版本" : "发布"}
                </Button>
              )}
              <Dropdown menu={{ items: menu }}>
                <Button icon={<MoreOutlined />} aria-label="页面更多操作" disabled={publishBusy} />
              </Dropdown>
            </Space>
          </Space>
          {publishError && <Alert type="error" message={publishError} showIcon />}
          <Typography.Title level={1}>{row.title}</Typography.Title>
          <Space wrap>
            {mode === "working" && <Tag>工作副本</Tag>}
            {row.tags?.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
            {row.publishedVersion && (
              <span>发布版本 v{row.publishedVersion}</span>
            )}
            <span>
              {row.publisherName}{" "}
              {row.publishedAt &&
                dayjs(row.publishedAt).format("YYYY-MM-DD HH:mm")}
            </span>
          </Space>
          <div className="knowledge-reading-grid">
            <div>
              {row.contentMode === "FILE" ? (
                row.primaryFile ? (
                  <KnowledgeFilePreview
                    file={row.primaryFile}
                    scope={{ mode, versionId }}
                    canRetry={knowledgeCanRetry()}
                  />
                ) : (
                  <Alert
                    type="warning"
                    message="尚未上传主文件，或当前字段权限不允许查看文件"
                  />
                )
              ) : (
                <KnowledgeContent content={row.content} />
              )}
              {row.description && (
                <Typography.Paragraph
                  style={{ whiteSpace: "pre-wrap", marginTop: 16 }}
                >
                  {row.description}
                </Typography.Paragraph>
              )}
              {row.attachments
                ?.filter((f) => f.role !== "PRIMARY")
                .map((f) => (
                  <div key={f.id}>
                    <Button
                      type="link"
                      onClick={() =>
                        void downloadApiFile(
                          knowledgeFileUrl(f.id, { mode, versionId }),
                          f.originalName,
                        ).catch((e) => message.error((e as Error).message))
                      }
                    >
                      {f.originalName}
                    </Button>
                  </div>
                ))}
            </div>
            <aside className="knowledge-toc">
              <strong>目录</strong>
              {toc(row.content).map((h) => (
                <a key={h.index} href={`#knowledge-heading-${h.index}`}>
                  {h.title}
                </a>
              ))}
            </aside>
          </div>
        </article>
      </KnowledgeFileContext.Provider>
    );
  else body = <Empty description="选择左侧页面阅读，或新建页面开始编写" />;
  return (
    <div className="knowledge-wiki">
      <aside className="knowledge-sidebar">
        <Select
          aria-label="知识空间"
          value={spaceId}
          loading={spaces.isLoading}
          style={{ width: "100%" }}
          options={spaces.data?.map((s) => ({
            value: s.id,
            label: (
              <Space>
                <KnowledgeSpaceIcon value={s.icon} />
                {s.name}
              </Space>
            ),
          }))}
          onChange={(id) =>
            void safely(() => {
              setSpaceId(id);
              setSearch("");
              navigate("/knowledge");
            })
          }
        />
        {spaces.error && (
          <Alert type="error" message={(spaces.error as Error).message} />
        )}
        <Space wrap style={{ margin: "16px 0" }}>
          {selected?.canCreate &&
            hasResourcePermission("knowledge-pages", "create") && (
              <Dropdown
                menu={{
                  items: [
                    {
                      key: "rich",
                      label: (
                        <div>
                          <span>在线编写</span>
                          <div className="knowledge-menu-description">
                            直接在网页中编写知识内容。
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "file",
                      label: (
                        <div>
                          <span>上传文件</span>
                          <div className="knowledge-menu-description">
                            上传 Word、PDF、PPT、Excel
                            等原始文件，支持批量上传和在线预览。
                          </div>
                        </div>
                      ),
                      disabled: !hasFieldPermission(
                        "knowledge-pages",
                        "attachmentIds",
                        "update",
                      ),
                    },
                    {
                      key: "import",
                      label: (
                        <div>
                          <span>从文档导入为在线文章</span>
                          <div className="knowledge-menu-description">
                            将 DOCX、Markdown、HTML
                            转换为可在网页中继续编辑的正文。
                          </div>
                        </div>
                      ),
                      disabled: !hasResourcePermission(
                        "knowledge-pages",
                        "import",
                      ),
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === "rich")
                      void safely(() =>
                        beginCreate(
                          row?.spaceId === selected.id ? row.id : undefined,
                        ),
                      );
                    else if (key === "file")
                      void safely(() => setFileUploading(true));
                    else void safely(() => setImporting(true));
                  },
                }}
              >
                <Button
                  aria-label="新建知识"
                  icon={<PlusOutlined />}
                  loading={busy}
                >
                  新建知识
                </Button>
              </Dropdown>
            )}
        </Space>
        {selected &&
          ["EDITOR", "FULL_ACCESS"].includes(selected.accessLevel ?? "") &&
          hasResourcePermission("knowledge-pages", "update") && (
            <Select
              aria-label="页面树视图"
              value={showWorking ? "working" : "published"}
              onChange={(v) => setShowWorking(v === "working")}
              options={[
                { value: "published", label: "已发布页面" },
                { value: "working", label: "工作页面（含草稿）" },
              ]}
              style={{ width: "100%", marginBottom: 12 }}
            />
          )}
        {selected && (
          <PageTree
            space={selected}
            working={showWorking}
            refresh={refresh}
            onOpen={open}
          />
        )}
        <div className="knowledge-sidebar-footer">
          {spaces.data?.some((s) => s.canManage) &&
            hasResourcePermission("knowledge-pages", "update") &&
            hasFieldPermission("knowledge-pages", "status", "update") && (
              <Button
                type="link"
                onClick={() =>
                  void safely(() => navigate("/knowledge/archive"))
                }
              >
                已归档页面
              </Button>
            )}
          {(hasResourcePermission("knowledge-spaces", "create") ||
            (hasResourcePermission("knowledge-spaces", "update") &&
              spaces.data?.some((s) => s.canManage))) && (
            <Button
              type="link"
              onClick={() => void safely(() => navigate("/knowledge/settings"))}
            >
              空间设置
            </Button>
          )}
          {spaces.data?.some((s) => s.canManage) &&
            hasResourcePermission("knowledge-pages", "delete") && (
              <Button
                type="link"
                onClick={() => void safely(() => navigate("/knowledge/trash"))}
              >
                回收站
              </Button>
            )}
        </div>
      </aside>
      <main className="knowledge-main">
        <Input.Search
          aria-label="搜索知识页面"
          placeholder="搜索已发布标题、说明、标签、路径、文件名和在线正文"
          allowClear
          enterButton
          onSearch={(s) =>
            void safely(() => {
              setSearch(s.trim());
              setSearchPage(1);
            })
          }
          style={{ marginBottom: 24 }}
        />
        {createdFiles.length > 0 && (
          <Button onClick={() => setUploadResults(true)}>
            查看最近上传结果（{createdFiles.length}）
          </Button>
        )}
        {body}
      </main>
      <Modal
        open={Boolean(creating)}
        title="在线编写"
        okText="创建并编写"
        onCancel={() => setCreating(undefined)}
        onOk={() => void create()}
        confirmLoading={busy}
        okButtonProps={{ disabled: !validCreation }}
      >
        {creating && (
          <KnowledgeLocationPicker
            spaces={spaces.data ?? []}
            value={creating}
            onChange={setCreating}
            onValidityChange={setValidCreation}
            disabled={busy}
          />
        )}
      </Modal>
      {fileUploading && selected && (
        <KnowledgeFileUpload
          spaces={spaces.data ?? []}
          spaceId={selected.id}
          parentId={row?.spaceId === selected.id ? row.id : undefined}
          onClose={() => setFileUploading(false)}
          onCreated={(pages) => {
            setFileUploading(false);
            invalidate();
            setShowWorking(true);
            setCreatedFiles(pages);
            setUploadResults(true);
          }}
        />
      )}
      <Modal
        open={uploadResults}
        title="本批次已创建的知识页面"
        footer={null}
        onCancel={() => setUploadResults(false)}
      >
        <p>
          已创建 {createdFiles.length}{" "}
          个草稿。选择页面查看或编辑，发布后其他成员才能阅读。
        </p>
        <List
          dataSource={createdFiles}
          renderItem={(p) => (
            <List.Item>
              <Button
                type="link"
                onClick={() => {
                  setUploadResults(false);
                  void safely(() =>
                    navigate(`/knowledge/pages/${p.id}?mode=working`),
                  );
                }}
              >
                {p.title}
              </Button>
            </List.Item>
          )}
        />
      </Modal>
      {importing && selected && (
        <KnowledgeImport
          spaces={spaces.data ?? []}
          spaceId={selected.id}
          parentId={row?.spaceId === selected.id ? row.id : undefined}
          onClose={() => setImporting(false)}
          onCreated={(id) => {
            setImporting(false);
            invalidate();
            navigate(`/knowledge/pages/${id}?edit=1`);
          }}
        />
      )}
      {accessing && row && (
        <KnowledgeAccess
          kind="page"
          id={row.id}
          version={row.version}
          entries={row.access ?? []}
          restricted={row.accessRestricted}
          onClose={() => setAccessing(false)}
          onSaved={() => {
            setAccessing(false);
            invalidate();
          }}
        />
      )}
      <Modal
        open={moving}
        title="移动页面及子树 / 调整顺序"
        okButtonProps={{ disabled: !validMove }}
        onCancel={() => setMoving(false)}
        onOk={() => void move()}
        confirmLoading={busy}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          {destination && (
            <KnowledgeLocationPicker
              operation="move"
              spaces={spaces.data ?? []}
              value={{ spaceId: destination, parentId: parent }}
              disabled={busy}
              excludeId={row?.id}
              onValidityChange={setValidMove}
              onChange={(target) => {
                setDestination(target.spaceId);
                setParent(target.parentId);
              }}
            />
          )}
          <Input
            type="number"
            aria-label="页面排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          />
        </Space>
      </Modal>
      <Modal
        open={history}
        title="不可变发布历史"
        onCancel={() => setHistory(false)}
        footer={null}
      >
        {versions.error && (
          <Alert type="error" message={(versions.error as Error).message} />
        )}
        <List
          loading={versions.isLoading}
          dataSource={versions.data}
          renderItem={(v) => (
            <List.Item>
              <Button
                type="link"
                onClick={() => {
                  setHistory(false);
                  setParams({ versionId: v.id });
                }}
              >
                v{v.publishedVersion} · {v.title} · {v.publisherName} ·{" "}
                {dayjs(v.publishedAt).format("YYYY-MM-DD HH:mm")}
              </Button>
            </List.Item>
          )}
        />
        <Button
          onClick={() => {
            setHistory(false);
            setParams({});
          }}
        >
          当前发布版本
        </Button>
      </Modal>
    </div>
  );
}
function KnowledgeTrash({
  onRefresh,
  archived = false,
}: {
  onRefresh: () => void;
  archived?: boolean;
}) {
  const [query, setQuery] = useState<PlatformTableQuery>(blankPlatformQuery()),
    { message, modal } = App.useApp();
  const rows = useQuery({
    queryKey: ["knowledge", archived ? "archive" : "trash", query],
    queryFn: () =>
      api<PageResult>(
        `/knowledge/pages?${new URLSearchParams({ mode: archived ? "published" : "trash", ...(archived ? { status: "ARCHIVED" } : {}), page: String(query.page), pageSize: String(query.pageSize), filterGroup: JSON.stringify(query.filterGroup), ...(query.sortField ? { sortField: query.sortField, sortOrder: query.sortOrder ?? "asc" } : {}) })}`,
      ),
    retry: false,
  });
  const action = async (p: KnowledgePage, permanent: boolean) => {
    try {
      await api(
        `/knowledge/pages/${p.id}/${permanent ? "permanent" : archived ? "unarchive" : "restore"}`,
        {
          method: permanent ? "DELETE" : "POST",
          body: JSON.stringify({ expectedVersion: p.version }),
        },
      );
      onRefresh();
    } catch (e) {
      message.error((e as Error).message);
      throw e;
    }
  };
  return (
    <>
      <Typography.Title level={3}>
        {archived ? "已归档页面" : "回收站"}
      </Typography.Title>
      {rows.error && (
        <Alert type="error" message={(rows.error as Error).message} />
      )}
      <KdosDataTable<KnowledgePage>
        resource="knowledge-pages"
        rowKey="id"
        dataSource={rows.data?.rows}
        loading={rows.isLoading}
        serverData={{ total: rows.data?.total ?? 0, onQueryChange: setQuery }}
        columns={[
          {
            title: "页面标题",
            dataIndex: "title",
            render: (title, p) => (
              <Space>
                <span>
                  {archived ? (
                    <a href={`/knowledge/pages/${p.id}`}>{title}</a>
                  ) : (
                    title
                  )}
                </span>
                {hasResourcePermission("knowledge-pages", "update") && (
                  <Button onClick={() => void action(p, false)}>恢复</Button>
                )}
                {!archived &&
                  hasResourcePermission("knowledge-pages", "delete") && (
                    <Button
                      danger
                      onClick={() =>
                        modal.confirm({
                          title:
                            "永久删除该页面、子树及历史附件？此操作无法恢复。",
                          onOk: () => action(p, true),
                        })
                      }
                    >
                      永久删除
                    </Button>
                  )}
              </Space>
            ),
          },
          { title: "状态", dataIndex: "status" },
          {
            title: "更新时间",
            dataIndex: "updatedAt",
            render: (v) => (v ? dayjs(v).format("YYYY-MM-DD HH:mm") : ""),
          },
        ]}
      />
    </>
  );
}
