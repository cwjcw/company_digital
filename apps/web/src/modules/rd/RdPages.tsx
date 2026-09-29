import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, InputNumber, Popconfirm, Progress, Segmented, Select, Space, Statistic, Tag, Typography, message } from "antd";
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
  scanMode?: "FULL" | "INCREMENTAL" | string;
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
  itemCount?: number;
  processedItems?: number;
  totalItems?: number;
  processedBlocks?: number;
  totalBlocks?: number;
  progressPercent?: number;
};

const kindOptions = [
  { label: "高相似", value: "similar" },
  { label: "名称规格一致", value: "exact" },
  { label: "同名缺规格", value: "missing" },
  { label: "同品号多记录", value: "code" },
];

const scanStatusLabels: Record<string, string> = {
  IDLE: "待扫描",
  RUNNING: "扫描中",
  COMPLETE: "扫描完成",
  FAILED: "扫描失败",
};

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
  const [scan, setScan] = useState<Scan | null>(null);
  const [kind, setKind] = useState("similar");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(50);
  const [codeFilter, setCodeFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [specFilter, setSpecFilter] = useState("");
  const [minScore, setMinScore] = useState<number | null>(null);
  const latestScan = useQuery({ queryKey: ["rd-latest-scan"], queryFn: () => api<Scan | null>("/rd/material-duplicates/scans/latest") });

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
    queryKey: ["rd-scan", scan?.id ?? latestScan.data?.id, queryParams],
    enabled: Boolean(scan?.id ?? latestScan.data?.id),
    queryFn: () => api<Scan>(`/rd/material-duplicates/scans/${scan?.id ?? latestScan.data?.id}?${queryParams}`),
    refetchInterval: (query) => query.state.data?.status === "RUNNING" ? 1200 : false,
  });
  const current = scanQuery.data ?? scan ?? latestScan.data;
  const status = current?.status ?? "IDLE";
  const start = async (mode: "FULL" | "INCREMENTAL") => {
    try {
      const result = await api<Scan & { message?: string; scanId?: string }>("/rd/material-duplicates/scans", { method: "POST", body: JSON.stringify({ mode }) });
      if (result.status === "NO_CHANGES") { message.info(result.message ?? "当前物料数据无变化，无需重新扫描。"); if (result.scanId) setScan({ ...result, id: result.scanId, status: "COMPLETE" }); return; }
      if (result.status === "RULE_MISMATCH") { message.warning(result.message ?? "查重规则已更新，请执行全量重建。"); return; }
      setScan(result);
      setHistoryPage(1);
    } catch (error) {
      message.error((error as Error).message);
    }
  };
  const resetHistory = () => {
    setCodeFilter(""); setNameFilter(""); setSpecFilter(""); setMinScore(null); setHistoryPage(1);
  };
  return <div className="rd-page rd-duplicates-page">
    <PageHeader title="一物多码检测" />
    <Alert type="warning" showIcon message="匹配分仅用于排序和辅助判断，不是重复概率。系统不会自动删除、合并或认定两个品号相同，请由研发人员人工确认。" className="rd-notice" />
    <Typography.Paragraph type="secondary" className="rd-full-scan-description">对当前物料库全部物料进行查重分析，识别可能存在的一物多码、名称规格一致、同名规格缺失及同品号多记录等情况，结果供人工核对。</Typography.Paragraph>

    <section className="rd-history-section">
      <div className="rd-section-heading"><div><Typography.Title level={5}>全量查重</Typography.Title><Typography.Text type="secondary">更新查重只处理上次成功扫描后新增或修改的物料，但结果始终覆盖当前物料库全部物料。</Typography.Text></div><Space><Button type="primary" onClick={() => void start("INCREMENTAL")} disabled={status === "RUNNING"}>更新查重</Button><Popconfirm title="确认全量重建？" description="重新计算当前物料库全部查重结果，耗时较长，仅在规则调整或数据异常时使用。" okText="确认重建" cancelText="取消" onConfirm={() => void start("FULL")}><Button disabled={status === "RUNNING"}>全量重建</Button></Popconfirm></Space></div>
      <div className={`rd-scan-status rd-scan-status-${status.toLowerCase()}`} role="status" aria-live="polite"><Tag color={status === "COMPLETE" ? "success" : status === "FAILED" ? "error" : status === "RUNNING" ? "processing" : "default"}>{scanStatusLabels[status] ?? "未知状态"}</Tag>{status === "IDLE" && "点击‘更新查重’，处理新增或修改的物料并更新全部查重结果。"}{status === "RUNNING" && `正在${current?.scanMode === "FULL" ? "进行全量重建" : "更新查重"}，请稍候。`}{status === "COMPLETE" && `${current?.scanMode === "FULL" ? "全量重建" : "查重更新"}已完成。`}{status === "FAILED" && (current?.errorMessage || "扫描失败，请查看错误信息后重新扫描。")}</div>
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
        <Segmented options={kindOptions} value={kind} onChange={(value) => { setKind(String(value)); setHistoryPage(1); }} />
        <Input value={codeFilter} onChange={(event) => updateHistoryFilter(setCodeFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="品号" allowClear />
        <Input value={nameFilter} onChange={(event) => updateHistoryFilter(setNameFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="品名" allowClear />
        <Input value={specFilter} onChange={(event) => updateHistoryFilter(setSpecFilter, event.target.value)} onPressEnter={() => setHistoryPage(1)} placeholder="规格" allowClear />
        <InputNumber min={0} max={100} value={minScore ?? undefined} onChange={(value) => { setMinScore(value); setHistoryPage(1); }} placeholder="最低匹配分" />
        <Select value={historyPageSize} onChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} options={[{ value: 20, label: "每页 20" }, { value: 50, label: "每页 50" }, { value: 100, label: "每页 100" }]} />
        <Button onClick={resetHistory}>重置</Button>
      </div>
      {scanQuery.isError && <Alert type="error" showIcon message={(scanQuery.error as Error).message} />}
      {status === "RUNNING" ? <div className="rd-scan-running"><Typography.Text>后台任务正在运行，页面会自动刷新进度。</Typography.Text></div> : status === "COMPLETE" ? <>
        <div className="rd-results-summary">{rdKindLabel(kind)}共 {formatCount(current?.totalGroups)} 组 · 第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</div>
        {(current?.groups ?? []).length ? <div className="rd-history-results">{(current?.groups ?? []).map((group) => <ComparisonCard key={group.id} group={group} />)}</div> : <Empty description="当前条件没有候选；不代表不存在重复物料。" />}
        <div className="rd-history-pager"><Button disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>上一页</Button><Typography.Text>第 {current?.page ?? historyPage} / {current?.pages ?? 1} 页</Typography.Text><Button disabled={historyPage >= (current?.pages ?? 1)} onClick={() => setHistoryPage((page) => page + 1)}>下一页</Button></div>
      </> : status === "IDLE" ? <Empty description="尚未开始扫描" /> : <Alert type="error" showIcon message="历史扫描失败，请点击“重新扫描”重试。" />}
    </section>
    <Typography.Paragraph type="secondary" className="rd-footnote">同一物料可能匹配多个候选，因此可能出现在多个候选组。这里只展示结果，不会自动删除、合并或放行新建；自制件仍须人工核对图纸、孔位和版本。</Typography.Paragraph>
  </div>;
}
