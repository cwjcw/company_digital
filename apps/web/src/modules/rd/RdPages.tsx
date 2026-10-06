import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, InputNumber, Popconfirm, Progress, Segmented, Select, Space, Statistic, Tag, Typography, message } from "antd";
import { api } from "../../api";
import { PageHeader } from "../../shared/legacy-ui";
import { hasSessionResourcePermission, KdosDataTable, kdosDefaultPageSize } from "../../shared/KdosDataTable";
import { displayParts, rdKindLabel } from "./rd-display";

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
  scanMode?: "FULL" | "INCREMENTAL" | string;
  stage?: string;
  rows?: number;
  counts?: Record<string, number>;
  groups?: DuplicateGroup[];
  totalGroups?: number;
  materialMatchCount?: number;
  groupCounts?: { all: number; similar: number; exact: number; missing: number; code: number };
  page?: number;
  pages?: number;
  pageSize?: number;
  startedAt?: string;
  finishedAt?: string;
  comparedPairs?: number;
  skippedBlocks?: number;
  skippedPairs?: number;
  errorMessage?: string;
  itemCount?: number;
  processedItems?: number;
  totalItems?: number;
  processedBlocks?: number;
  totalBlocks?: number;
  progressPercent?: number;
};

type RdSession = { isSystemAdmin?: boolean; permissions?: string[]; moduleAdminCodes?: string[] };
type DuplicateFilters = { kind: string; code: string; name: string; spec: string; minScore: number | null };

const kindOptions = [
  { label: "全部", value: "all" },
  { label: "高相似", value: "similar" },
  { label: "名称规格一致", value: "exact" },
  { label: "同名缺规格", value: "missing" },
  { label: "同品号多记录", value: "code" },
];

const scanStatusLabels: Record<string, string> = {
  IDLE: "待计算",
  RUNNING: "计算中",
  COMPLETE: "计算完成",
  FAILED: "计算失败",
};

const formatCount = (value: unknown) => typeof value === "number" ? value.toLocaleString("zh-CN") : "—";
const formatTime = (value?: string | null) => value ? value.replace("T", " ").replace(/\.\d+Z?$/, "") : "—";

function DiffText({ value, other, query }: { value: unknown; other: unknown; query?: string }) {
  const parts = displayParts(value, other, query);
  if (!parts.length) return <span className={String(other ?? "") ? "rd-diff-empty" : "rd-empty-value"}>（空）</span>;
  return <>{parts.map((part, index) => <span key={`${index}-${part.changed ? "diff" : "same"}-${part.queryMatched ? "query" : "plain"}`} className={[part.changed ? "rd-diff-char" : "", part.queryMatched ? "rd-query-highlight" : ""].filter(Boolean).join(" ") || undefined}>{part.text}</span>)}</>;
}

function InlineField({ label, value, other, query, className }: { label: string; value: unknown; other: unknown; query?: string; className: string }) {
  return <div className={`rd-compare-inline-field ${className}`}>
    <span className="rd-compare-inline-label">{label}：</span>
    <span className="rd-compare-inline-value" title={String(value ?? "") || "（空）"}><DiffText value={value} other={other} query={query} /></span>
  </div>;
}

function ComparisonCard({ group, filters }: { group: DuplicateGroup; filters: DuplicateFilters }) {
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
    <div className="rd-compare-rows">
      <div className="rd-compare-row" data-testid="rd-compare-row-a">
        <strong className="rd-compare-side">A物料</strong>
        <InlineField label="品号" value={left.code} other={right.code} query={filters.code} className="rd-compare-code" />
        <InlineField label="品名" value={left.name} other={right.name} query={filters.name} className="rd-compare-name" />
        <InlineField label="规格" value={left.spec} other={right.spec} query={filters.spec} className="rd-compare-spec" />
      </div>
      <div className="rd-compare-row" data-testid="rd-compare-row-b">
        <strong className="rd-compare-side">B物料</strong>
        <InlineField label="品号" value={right.code} other={left.code} query={filters.code} className="rd-compare-code" />
        <InlineField label="品名" value={right.name} other={left.name} query={filters.name} className="rd-compare-name" />
        <InlineField label="规格" value={right.spec} other={left.spec} query={filters.spec} className="rd-compare-spec" />
      </div>
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

const emptyDuplicateFilters: DuplicateFilters = { kind: "all", code: "", name: "", spec: "", minScore: null };

export function RdDuplicatesPage({ user }: { user: RdSession }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [draftFilters, setDraftFilters] = useState<DuplicateFilters>(emptyDuplicateFilters);
  const [appliedFilters, setAppliedFilters] = useState<DuplicateFilters>(emptyDuplicateFilters);
  const latestScan = useQuery({ queryKey: ["rd-latest-scan"], queryFn: () => api<Scan | null>("/rd/material-duplicates/scans/latest") });
  const canRunFullCalculation = hasSessionResourcePermission(user, "rd-material-duplicates", "update");
  const canManagePermission = user.isSystemAdmin === true || user.moduleAdminCodes?.includes("rd") === true;

  const updateDraftFilter = <K extends keyof DuplicateFilters>(key: K, value: DuplicateFilters[K]) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(historyPage), pageSize: String(historyPageSize), kind: appliedFilters.kind });
    if (appliedFilters.code.trim()) params.set("code", appliedFilters.code.trim());
    if (appliedFilters.name.trim()) params.set("name", appliedFilters.name.trim());
    if (appliedFilters.spec.trim()) params.set("spec", appliedFilters.spec.trim());
    if (appliedFilters.minScore != null) params.set("minScore", String(appliedFilters.minScore));
    return params.toString();
  }, [appliedFilters, historyPage, historyPageSize]);
  const scanQuery = useQuery({
    queryKey: ["rd-scan", scan?.id ?? latestScan.data?.id, queryParams],
    enabled: Boolean(scan?.id ?? latestScan.data?.id),
    queryFn: () => api<Scan>(`/rd/material-duplicates/scans/${scan?.id ?? latestScan.data?.id}?${queryParams}`),
    refetchInterval: (query) => query.state.data?.status === "RUNNING" ? 1200 : false,
  });
  const current = scanQuery.data ?? scan ?? latestScan.data;
  const status = current?.status ?? "IDLE";
  const groupCounts = current?.groupCounts ?? { all: 0, similar: 0, exact: 0, missing: 0, code: 0 };
  const categoryOptions = kindOptions.map((option) => ({ ...option, label: `${option.label} ${formatCount(groupCounts[option.value as keyof typeof groupCounts])}` }));
  const hasMaterialFilters = [appliedFilters.code, appliedFilters.name, appliedFilters.spec].some(Boolean);
  const emptyDescription = Number(current?.materialMatchCount ?? 0) > 0
    ? `物料库中找到 ${formatCount(current?.materialMatchCount)} 条符合条件的物料，但当前分类下没有已保存的疑似重复组。`
    : hasMaterialFilters ? "当前物料库中未找到符合条件的物料。" : "当前分类没有已保存的疑似重复组。";
  const applyQuery = () => {
    setAppliedFilters({ ...draftFilters, code: draftFilters.code.trim(), name: draftFilters.name.trim(), spec: draftFilters.spec.trim() });
    setHistoryPage(1);
  };
  const resetHistory = () => {
    setDraftFilters(emptyDuplicateFilters);
    setAppliedFilters(emptyDuplicateFilters);
    setHistoryPage(1);
  };
  const runFullCalculation = async () => {
    try {
      const result = await api<Scan>("/rd/material-duplicates/scans", { method: "POST", body: JSON.stringify({ mode: "FULL" }) });
      setScan(result);
      setHistoryPage(1);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  return <div className="rd-page rd-duplicates-page">
    <PageHeader title="一物多码检测" actions={canManagePermission ? <Button href="/permissions/rd-material-duplicates?from=/rd/material-duplicates">权限管理</Button> : undefined} />
    <Alert type="warning" showIcon message="匹配分仅用于排序和辅助判断，不是重复概率。系统不会自动删除、合并或认定两个品号相同，请由研发人员人工确认。" className="rd-notice" />
    <Typography.Paragraph type="secondary" className="rd-full-scan-description">对当前物料库全部物料进行查重分析，识别可能存在的一物多码、名称规格一致、同名规格缺失及同品号多记录等情况，结果供人工核对。</Typography.Paragraph>

    <section className="rd-history-section">
      <div className="rd-section-heading"><div><Typography.Title level={5}>全量查重</Typography.Title><Typography.Text type="secondary">普通用户只能查询已保存的查重结果；研发中心管理员可以重新计算当前物料库全部查重结果。</Typography.Text></div><Space>{canRunFullCalculation && <Popconfirm title="确认全量计算？" description="将重新计算当前物料库全部查重结果，可能需要一定时间。确认继续吗？" okText="确认继续" cancelText="取消" onConfirm={() => void runFullCalculation()}><Button disabled={status === "RUNNING"}>全量计算</Button></Popconfirm>}</Space></div>
      <div className={`rd-scan-status rd-scan-status-${status.toLowerCase()}`} role="status" aria-live="polite"><Tag color={status === "COMPLETE" ? "success" : status === "FAILED" ? "error" : status === "RUNNING" ? "processing" : "default"}>{scanStatusLabels[status] ?? "未知状态"}</Tag>{status === "IDLE" && "当前暂无已保存的查重结果。"}{status === "RUNNING" && "正在计算全量查重，请稍候。"}{status === "COMPLETE" && "全量查重已完成。"}{status === "FAILED" && (current?.errorMessage || "计算失败，请查看错误信息后联系管理员重新计算。")}</div>
      {status === "RUNNING" && <div className="rd-scan-progress"><Progress percent={Math.round(Number(current?.progressPercent ?? 0))} status="active" /><Typography.Text type="secondary">阶段：{current?.stage || "处理中"} · 已处理物料 {formatCount(current?.processedItems)} / {formatCount(current?.totalItems)} · 已处理候选分组 {formatCount(current?.processedBlocks)} / {formatCount(current?.totalBlocks)}</Typography.Text></div>}
      <div className="rd-scan-stats">
        <Statistic title="物料总数" value={formatCount(current?.itemCount ?? current?.rows)} />
        <Statistic title="扫描时间" value={formatTime(current?.finishedAt || current?.startedAt)} />
        <Statistic title="已比较候选对" value={formatCount(current?.comparedPairs)} />
        <Statistic title="已跳过候选分组" value={formatCount(current?.skippedBlocks)} />
        <Statistic title="已跳过候选对" value={formatCount(current?.skippedPairs)} />
      </div>
      <div className="rd-results-heading"><Typography.Title level={5}>查重结果</Typography.Title></div>
      <div className="rd-history-filters">
        <label className="rd-history-filter-item rd-history-filter-code" data-testid="rd-filter-code">
          <span className="rd-history-filter-label">品号</span>
          <Input value={draftFilters.code} onChange={(event) => updateDraftFilter("code", event.target.value)} placeholder="品号" allowClear />
        </label>
        <label className="rd-history-filter-item rd-history-filter-name" data-testid="rd-filter-name">
          <span className="rd-history-filter-label">品名</span>
          <Input value={draftFilters.name} onChange={(event) => updateDraftFilter("name", event.target.value)} placeholder="品名" allowClear />
        </label>
        <label className="rd-history-filter-item rd-history-filter-spec" data-testid="rd-filter-spec">
          <span className="rd-history-filter-label">规格</span>
          <Input value={draftFilters.spec} onChange={(event) => updateDraftFilter("spec", event.target.value)} placeholder="规格" allowClear />
        </label>
        <label className="rd-history-filter-item rd-history-filter-score" data-testid="rd-filter-score">
          <span className="rd-history-filter-label">最低匹配分</span>
          <InputNumber min={0} max={100} value={draftFilters.minScore ?? undefined} onChange={(value) => updateDraftFilter("minScore", value)} placeholder="分数" />
        </label>
        <label className="rd-history-filter-item rd-history-filter-page-size" data-testid="rd-filter-page-size">
          <span className="rd-history-filter-label">每页</span>
          <Select aria-label="每页条数" value={historyPageSize} onChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} options={[{ value: 20, label: "20 条" }, { value: 50, label: "50 条" }, { value: 100, label: "100 条" }]} />
        </label>
        <div className="rd-history-filter-actions" data-testid="rd-filter-actions">
          <Button type="primary" onClick={applyQuery}>查询</Button>
          <Button onClick={resetHistory}>重置</Button>
        </div>
        <div className="rd-history-filter-item rd-history-filter-category" data-testid="rd-filter-category">
          <span className="rd-history-filter-label">分类</span>
          <Segmented options={categoryOptions} value={draftFilters.kind} onChange={(value) => updateDraftFilter("kind", String(value))} />
        </div>
      </div>
      {status === "COMPLETE" && <div className="rd-query-summary" data-testid="rd-query-summary"><Tag color="blue">物料库命中：{formatCount(current?.materialMatchCount)}</Tag><Tag color="geekblue">疑似重复组：{formatCount(current?.totalGroups)}</Tag></div>}
      {scanQuery.isError && <Alert type="error" showIcon message={(scanQuery.error as Error).message} />}
      {status === "RUNNING" ? <div className="rd-scan-running"><Typography.Text>后台任务正在运行，页面会自动刷新进度。</Typography.Text></div> : status === "COMPLETE" ? <>
        <div className="rd-results-summary">{rdKindLabel(appliedFilters.kind)}共 {formatCount(current?.totalGroups)} 组 · 第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</div>
        {(current?.groups ?? []).length ? <div className="rd-history-results">{(current?.groups ?? []).map((group) => <ComparisonCard key={group.id} group={group} filters={appliedFilters} />)}</div> : <Empty description={emptyDescription}>{Number(current?.materialMatchCount ?? 0) > 0 && <Typography.Text type="secondary" className="rd-empty-note">这不代表物料不存在，也不代表不存在其他类型的疑似重复，请尝试“全部”或其他分类。</Typography.Text>}</Empty>}
        <div className="rd-history-pager"><Button disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</Button><Typography.Text>第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</Typography.Text><Button disabled={historyPage >= (current?.pages ?? 1)} onClick={() => setHistoryPage((page) => page + 1)}>下一页</Button></div>
      </> : status === "IDLE" ? <Empty description="暂无已保存的查重结果" /> : <Alert type="error" showIcon message="查重计算失败，请联系管理员重新计算。" />}
    </section>
    <Typography.Paragraph type="secondary" className="rd-footnote">同一物料可能匹配多个候选，因此可能出现在多个候选组。这里只展示结果，不会自动删除、合并或放行新建；自制件仍须人工核对图纸、孔位和版本。</Typography.Paragraph>
  </div>;
}
