import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, InputNumber, Segmented, Select, Space, Statistic, Tag, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { diffParts, rdKindLabel } from "./rd-display";

type TablePage = { rows: any[]; total: number; page: number; pageSize: number };
type MaterialRecord = { row?: number; code?: string | null; name?: string | null; spec?: string | null };
type DuplicateGroup = {
  id: string | number;
  groupNo?: number;
  kind: string;
  score?: number | null;
  reason?: string;
  warnings?: string[];
  memberCount?: number;
  distinctCodes?: number;
  membersTruncated?: boolean;
  records?: MaterialRecord[];
};
type Scan = {
  id: string;
  status: "IDLE" | "RUNNING" | "COMPLETE" | "FAILED" | string;
  stage?: string;
  rows?: number;
  counts?: Record<string, number>;
  groups?: DuplicateGroup[];
  totalGroups?: number;
  page?: number;
  pages?: number;
  pageSize?: number;
  startedAt?: string;
  finishedAt?: string;
  comparedPairs?: number;
  skippedBlocks?: number;
  skippedPairs?: number;
  errorMessage?: string;
};

const kindOptions = [
  { label: "高相似候选", value: "similar" },
  { label: "名称规格一致", value: "exact" },
  { label: "同名规格缺失", value: "missing" },
  { label: "同品号多记录", value: "code" },
];

const formatCount = (value: unknown) => typeof value === "number" ? value.toLocaleString("zh-CN") : "—";
const formatTime = (value?: string | null) => value ? value.replace("T", " ").replace(/\.\d+Z?$/, "") : "—";

function DiffText({ value, other }: { value: unknown; other: unknown }) {
  const parts = diffParts(value, other)[0];
  if (!parts.length) return <span className={String(other ?? "") ? "rd-diff-empty" : "rd-empty-value"}>（空）</span>;
  return <>{parts.map((part, index) => <span key={`${index}-${part.changed ? "diff" : "same"}`} className={part.changed ? "rd-diff-char" : undefined}>{part.text}</span>)}</>;
}

function FieldDiff({ label, left, right }: { label: string; left: unknown; right: unknown }) {
  return <div className="rd-compare-field">
    <div className="rd-compare-label">{label}</div>
    <div className="rd-compare-value"><DiffText value={left} other={right} /></div>
    <div className="rd-compare-value"><DiffText value={right} other={left} /></div>
  </div>;
}

function ComparisonCard({ group }: { group: DuplicateGroup }) {
  const records = group.records ?? [];
  const left = records[0] ?? {};
  const right = records[1] ?? {};
  return <article className="rd-history-group">
    <div className="rd-comparison-head">
      <Space size={6} wrap>
        <Tag color="blue">候选组 {group.groupNo ?? "—"}</Tag>
        <Tag>{rdKindLabel(group.kind)}</Tag>
        {group.membersTruncated && <Tag color="warning">成员过多，已截取展示</Tag>}
      </Space>
      <Space size={12}>
        <Typography.Text strong className="rd-score">{group.score == null ? "—" : `${Number(group.score).toFixed(1)} 分`}</Typography.Text>
        <Typography.Text type="secondary">{group.memberCount ?? records.length} 条记录 · {group.distinctCodes ?? "—"} 个品号</Typography.Text>
      </Space>
    </div>
    <div className="rd-compare-grid rd-compare-grid-header"><span /> <strong>A · {left.code || "未提供品号"}</strong><strong>B · {right.code || "未提供品号"}</strong></div>
    <div className="rd-compare-grid rd-compare-grid-body">
      <FieldDiff label="品号" left={left.code} right={right.code} />
      <FieldDiff label="品名" left={left.name} right={right.name} />
      <FieldDiff label="规格" left={left.spec} right={right.spec} />
    </div>
    <div className="rd-compare-meta">
      <Typography.Text strong>判断依据：</Typography.Text> {group.reason || "—"}
      <span className="rd-record-rows">A Excel 行 {left.row ?? "—"} · B Excel 行 {right.row ?? "—"}</span>
    </div>
    {(group.warnings ?? []).length > 0 && <div className="rd-warnings"><Typography.Text strong>核查提示：</Typography.Text> {(group.warnings ?? []).join("；")}</div>}
    {records.length > 2 && <div className="rd-extra-records"><Typography.Text type="secondary">其余记录：</Typography.Text> {records.slice(2).map((record) => <Tag key={`${record.row}-${record.code}`}>{record.code || "（无品号）"} · {record.name || "（无品名）"}</Tag>)}</div>}
  </article>;
}

export function RdItemsPage() {
  const [query, setQuery] = useState({ page: 1, pageSize: kdosDefaultPageSize, search: "" });
  const [searchField, setSearchField] = useState("all");
  const rows = useQuery({ queryKey: ["rd-items", query], queryFn: () => api<TablePage>(`/rd/items?page=${query.page}&pageSize=${query.pageSize}&search=${encodeURIComponent(query.search)}`), placeholderData: (previous) => previous });
  const status = useQuery({ queryKey: ["rd-items-status"], queryFn: () => api<any>("/rd/items/status") });
  const columns = [
    { title: "品号", dataIndex: "itemCode", width: 180, fixed: "left" as const },
    { title: "品名", dataIndex: "itemName", width: 220, fixed: "left" as const },
    { title: "规格", dataIndex: "specification", width: 260 },
    { title: "备注", dataIndex: "remark", width: 220 },
    { title: "归类品", dataIndex: "isGroupItem", width: 90, render: (value: boolean | null) => value == null ? "" : value ? "是" : "否" },
    { title: "创建日期", dataIndex: "sourceCreatedAt", width: 170 },
    { title: "最后修改日期", dataIndex: "sourceLastModifiedAt", width: 170 },
    { title: "修改日期", dataIndex: "sourceModifiedAt", width: 170 },
    { title: "创建人", dataIndex: "createdByName", width: 140 },
    { title: "最后修改人", dataIndex: "lastModifiedByName", width: 140 },
    { title: "修改人", dataIndex: "modifiedByName", width: 140 },
    { title: "状态", dataIndex: "status", width: 80 }
  ];
  const searchHint = searchField === "all" ? "搜索品号、品名或规格" : `搜索${searchField === "code" ? "品号" : searchField === "name" ? "品名" : "规格"}`;
  return <div className="rd-page">
    <PageHeader title="物料数据" actions={<Space wrap><Tag color="blue">当前物料 {formatCount(status.data?.activeItemCount)}</Tag><Tag color="geekblue">当前筛选 {formatCount(rows.data?.total)}</Tag><Tag>最近同步 {status.data?.latestSync?.finishedAt ?? status.data?.lastSuccessfulSyncAt ?? "—"}</Tag><Tag color={status.data?.latestSync?.status === "FAILED" ? "error" : "success"}>同步状态 {status.data?.latestSync?.status ?? "—"}</Tag></Space>} />
    <div className="rd-items-toolbar"><Space wrap size={8}><Typography.Text type="secondary">搜索字段</Typography.Text><Select value={searchField} onChange={setSearchField} options={[{ value: "all", label: "全部字段" }, { value: "code", label: "品号" }, { value: "name", label: "品名" }, { value: "spec", label: "规格" }]} /><Typography.Text type="secondary">当前表格搜索按现有接口对品号、品名、规格统一匹配</Typography.Text></Space></div>
    <KdosDataTable resource="rd-items" viewKey="rd-items-density" rowKey="id" loading={rows.isLoading} dataSource={rows.data?.rows} columns={columns} searchPlaceholder={searchHint} serverData={{ total: rows.data?.total ?? 0, onQueryChange: setQuery }} scroll={{ x: "max-content" }} />
  </div>;
}

export function RdDuplicatesPage() {
  const [itemName, setItemName] = useState("");
  const [specification, setSpecification] = useState("");
  const [liveLimit, setLiveLimit] = useState(5);
  const [live, setLive] = useState<any>();
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [kind, setKind] = useState("similar");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [codeFilter, setCodeFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [specFilter, setSpecFilter] = useState("");
  const [minScore, setMinScore] = useState<number | null>(null);

  const runLive = useCallback(async (windowSize: 5000 | 20000) => {
    if (!itemName.trim() && !specification.trim()) {
      setLive(undefined);
      setLiveError("");
      return;
    }
    setLiveLoading(true);
    setLiveError("");
    try {
      // The current API deliberately uses limit=10 as the equivalent 20,000-row window switch.
      const result = await api<any>("/rd/material-duplicates/check", { method: "POST", body: JSON.stringify({ itemName, specification, limit: windowSize === 20000 ? 10 : liveLimit }) });
      setLive({ ...result, requestedWindow: windowSize === 20000 || liveLimit === 10 ? 20000 : 5000 });
    } catch (error) {
      setLiveError((error as Error).message);
      setLive(undefined);
    } finally {
      setLiveLoading(false);
    }
  }, [itemName, specification, liveLimit]);

  useEffect(() => {
    const timer = window.setTimeout(() => void runLive(5000), 350);
    return () => window.clearTimeout(timer);
  }, [runLive]);

  const updateHistoryFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setHistoryPage(1);
  };
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(historyPage), pageSize: String(historyPageSize), kind });
    if (codeFilter.trim()) params.set("code", codeFilter.trim());
    if (nameFilter.trim()) params.set("name", nameFilter.trim());
    if (specFilter.trim()) params.set("spec", specFilter.trim());
    if (minScore != null) params.set("minScore", String(minScore));
    return params.toString();
  }, [codeFilter, historyPage, historyPageSize, kind, minScore, nameFilter, specFilter]);
  const scanQuery = useQuery({
    queryKey: ["rd-scan", scan?.id, queryParams],
    enabled: Boolean(scan?.id),
    queryFn: () => api<Scan>(`/rd/material-duplicates/scans/${scan?.id}?${queryParams}`),
    refetchInterval: (query) => query.state.data?.status === "RUNNING" ? 1200 : false,
  });
  const current = scanQuery.data ?? scan;
  const status = current?.status ?? "IDLE";
  const counts = current?.counts ?? {};
  const start = async () => {
    try {
      const result = await api<Scan>("/rd/material-duplicates/scans", { method: "POST" });
      setScan(result);
      setHistoryPage(1);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const resetHistory = () => {
    setCodeFilter(""); setNameFilter(""); setSpecFilter(""); setMinScore(null); setHistoryPage(1);
  };
  const liveResults = live?.results ?? [];

  return <div className="rd-page rd-duplicates-page">
    <PageHeader title="一物多码检测" />
    <Alert type="warning" showIcon message="匹配分仅用于排序和辅助判断，不是重复概率。系统不会自动删除、合并或认定两个品号相同，请由研发人员人工确认。" className="rd-notice" />

    <section className="rd-quick-search">
      <div className="rd-section-heading"><div><Typography.Title level={5}>新物料快速检索</Typography.Title><Typography.Text type="secondary">输入品名、规格后，系统自动按最后修改时间倒序，在当前物料库最近 5,000 条物料中检索相似候选；点击“查找最近 2 万条”可将检索范围扩大至最近 20,000 条物料。</Typography.Text></div><Space size={8}><Typography.Text type="secondary">Top</Typography.Text><Select size="small" value={liveLimit} onChange={setLiveLimit} options={[{ value: 5, label: "5" }, { value: 10, label: "10（2万条）" }]} /></Space></div>
      <div className="rd-quick-fields">
        <Input value={itemName} onChange={(event) => setItemName(event.target.value)} onPressEnter={() => void runLive(20000)} placeholder="品名（主要输入）" aria-label="新物料品名" />
        <Input value={specification} onChange={(event) => setSpecification(event.target.value)} onPressEnter={() => void runLive(20000)} placeholder="规格（主要输入）" aria-label="新物料规格" />
        <Button type="primary" onClick={() => void runLive(20000)} loading={liveLoading}>查找最近 2 万条</Button>
      </div>
      {liveError && <Typography.Text type="danger">{liveError}</Typography.Text>}
      {liveLoading && !live && <div className="rd-live-state">正在检索近期物料…</div>}
      {live && <div className="rd-live-results" aria-live="polite">
        <div className="rd-live-summary">已检索最近 {formatCount(live.rowsScanned)} 条，返回 {liveResults.length} 条候选{live.requestedWindow === 5000 ? "（输入中实时预览）" : "（最近 2 万条）"}</div>
        {liveResults.length === 0 ? <div className="rd-live-state">未找到足够接近的候选；这不代表一定可以新建。</div> : liveResults.map((item: any, index: number) => <div className="rd-live-item" key={`${item.code ?? "empty"}-${index}`}>
          <strong className="rd-live-score">{Number(item.score).toFixed(1)} 分</strong><span className="rd-live-code">{item.code || "（无品号）"}</span><span>{item.name || "（无品名）"}</span><span>{item.spec || "（无规格）"}</span>
          <span className="rd-live-reason">判断依据：{item.reason || "—"}{item.warnings?.length ? `；核查提示：${item.warnings.join("；")}` : ""}</span>
        </div>)}
      </div>}
    </section>

    <section className="rd-history-section">
      <div className="rd-section-heading"><div><Typography.Title level={5}>历史物料检测</Typography.Title><Typography.Text type="secondary">用于对历史物料进行相似性检测，帮助识别可能存在的一物多码、名称规格一致、同名规格缺失及同品号多记录等情况。默认展示高相似候选，供人工核对。</Typography.Text></div><Button type="primary" onClick={() => void start()} disabled={status === "RUNNING"}>{status === "COMPLETE" ? "重新扫描" : "开始扫描"}</Button></div>
      <div className={`rd-scan-status rd-scan-status-${status.toLowerCase()}`} role="status" aria-live="polite"><Tag color={status === "COMPLETE" ? "success" : status === "FAILED" ? "error" : status === "RUNNING" ? "processing" : "default"}>{status.toLowerCase()}</Tag>{status === "IDLE" && "点击“开始扫描”读取当前数据库候选。"}{status === "RUNNING" && `正在扫描${current?.stage ? `：${current.stage}` : ""}，请稍候…`}{status === "COMPLETE" && `扫描完成 · ${formatCount(current?.rows)} 条物料 · ${formatTime(current?.finishedAt)}`}{status === "FAILED" && (current?.errorMessage || "扫描失败，请重新扫描。")}</div>
      <div className="rd-scan-stats">
        <Statistic title="物料总数" value={formatCount(current?.rows)} />
        <Statistic title="扫描时间" value={formatTime(current?.finishedAt || current?.startedAt)} />
        <Statistic title="exact · 名称规格一致" value={formatCount(counts.exact)} />
        <Statistic title="similar · 高相似" value={formatCount(counts.similar)} />
        <Statistic title="missing · 同名缺规格" value={formatCount(counts.missing)} />
        <Statistic title="code · 同品号多记录" value={formatCount(counts.code)} />
        <Statistic title="compared pairs" value={formatCount(current?.comparedPairs)} />
        <Statistic title="skipped blocks / pairs" value={`${formatCount(current?.skippedBlocks)} / ${formatCount(current?.skippedPairs)}`} />
      </div>
      <div className="rd-history-filters">
        <Segmented options={kindOptions} value={kind} onChange={(value) => { setKind(String(value)); setHistoryPage(1); }} />
        <Input value={codeFilter} onChange={(event) => updateHistoryFilter(setCodeFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="品号" allowClear />
        <Input value={nameFilter} onChange={(event) => updateHistoryFilter(setNameFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="品名" allowClear />
        <Input value={specFilter} onChange={(event) => updateHistoryFilter(setSpecFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="规格" allowClear />
        <InputNumber min={0} max={100} value={minScore ?? undefined} onChange={(value) => { setMinScore(value); setHistoryPage(1); }} placeholder="最低匹配分" />
        <Select value={historyPageSize} onChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} options={[{ value: 20, label: "每页 20" }, { value: 50, label: "每页 50" }, { value: 100, label: "每页 100" }]} />
        <Button onClick={resetHistory}>重置</Button>
      </div>
      {scanQuery.isError && <Alert type="error" showIcon message={(scanQuery.error as Error).message} />}
      {status === "RUNNING" ? <div className="rd-scan-running"><Typography.Text>扫描正在运行，页面会自动刷新状态。</Typography.Text></div> : status === "COMPLETE" ? <>
        <div className="rd-results-summary">{rdKindLabel(kind)}共 {formatCount(current?.totalGroups)} 组 · 第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</div>
        {(current?.groups ?? []).length ? <div className="rd-history-results">{(current?.groups ?? []).map((group) => <ComparisonCard key={group.id} group={group} />)}</div> : <Empty description="当前条件没有候选；不代表不存在重复物料。" />}
        <div className="rd-history-pager"><Button disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</Button><Typography.Text>第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</Typography.Text><Button disabled={historyPage >= (current?.pages ?? 1)} onClick={() => setHistoryPage((page) => page + 1)}>下一页</Button></div>
      </> : status === "IDLE" ? <Empty description="尚未开始扫描" /> : <Alert type="error" showIcon message="历史扫描失败，请点击“重新扫描”重试。" />}
    </section>
    <Typography.Paragraph type="secondary" className="rd-footnote">同一物料可能匹配多个候选，因此可能出现在多个候选组。这里只展示结果，不会自动删除、合并或放行新建；自制件仍须人工核对图纸、孔位和版本。</Typography.Paragraph>
  </div>;
}
