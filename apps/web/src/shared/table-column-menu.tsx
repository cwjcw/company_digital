import { useEffect, useState, type ReactNode } from "react";
import { Button, Checkbox, Divider, Input, Popover, Select, Space, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, FilterOutlined, MoreOutlined, PushpinOutlined } from "@ant-design/icons";
import { isTableFieldFilterable, type TableFilterOperator, type TablePermissionFieldDefinition } from "@kdos/contracts";
import { api } from "../api";
import { RuleValue, defaultOperatorFor, visibleOperators, type AdvancedFilterGroup, type AdvancedFilterRule } from "./advanced-filter";

type Candidate = { value: string; label: string };
type CandidateResponse = { options: Candidate[]; hasMore: boolean };
const EMPTY = "__kdos_header_empty__";

export function KdosColumnMenu({ title, resource, field, systemFixed, pinned, sortOrder, filtered, rules, tableSearch, advancedGroup, headerGroup, context,
  filterable, onSort, onPin, onHide, onFilter }: {
  title: ReactNode; resource: string; field: TablePermissionFieldDefinition; systemFixed: boolean; pinned: boolean;
  sortOrder?: "ascend" | "descend"; filtered: boolean; rules: AdvancedFilterRule[]; tableSearch: string;
  advancedGroup: AdvancedFilterGroup; headerGroup: AdvancedFilterGroup;
  context?: Record<string, unknown>;
  filterable: boolean;
  onSort: (order?: "ascend" | "descend") => void; onPin: () => void; onHide: () => void;
  onFilter: (rules: AdvancedFilterRule[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [typedRule, setTypedRule] = useState<AdvancedFilterRule>({ field: field.key, operator: defaultOperatorFor(field) ?? "eq" });
  const candidateField = ["text", "dictionary", "member", "department", "reference"].includes(field.type);
  useEffect(() => {
    if (!open) return;
    setFilterOpen(false); setSearch("");
    setSelected([...rules.flatMap((rule) => Array.isArray(rule.values) ? rule.values.map(String) : rule.operator === "is_empty" ? [EMPTY] : rule.value == null ? [] : [String(rule.value)])]);
    setTypedRule(rules.find((rule) => rule.operator !== "is_empty") ?? { field: field.key, operator: defaultOperatorFor(field) ?? "eq" });
  }, [open, field, rules]);
  useEffect(() => {
    if (!open || !filterOpen || !candidateField) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ resource, field: field.key, search, limit: "200", withMeta: "1", currentHeaderField: field.key,
        tableSearch, advancedFilterGroup: JSON.stringify(advancedGroup), headerFilterGroup: JSON.stringify(headerGroup) });
      if (context && Object.keys(context).length) params.set("context", JSON.stringify(context));
      try {
        const result = await api<CandidateResponse>(`/table-filters/candidates?${params}`);
        if (active) { setCandidates(result.options ?? []); setHasMore(Boolean(result.hasMore)); }
      } catch { if (active) { setCandidates([]); setHasMore(true); } }
      finally { if (active) setLoading(false); }
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, filterOpen, candidateField, resource, field.key, search, tableSearch, advancedGroup, headerGroup, context]);
  const finish = () => { setOpen(false); setFilterOpen(false); };
  const apply = () => {
    if (candidateField) {
      const values = selected.filter((value) => value !== EMPTY);
      const next: AdvancedFilterRule[] = [];
      if (values.length) next.push({ field: field.key, operator: field.multiple ? "contains_any" : "in", values });
      if (selected.includes(EMPTY)) next.push({ field: field.key, operator: "is_empty" });
      onFilter(next);
    } else onFilter([typedRule]);
    finish();
  };
  const filterPanel = candidateField ? <>
    <Input autoFocus allowClear value={search} placeholder="搜索字段值……" onChange={(event) => setSearch(event.target.value)} />
    <Checkbox checked={!hasMore && candidates.length > 0 && candidates.every((item) => selected.includes(item.value))}
      indeterminate={candidates.some((item) => selected.includes(item.value)) && !candidates.every((item) => selected.includes(item.value))}
      disabled={hasMore || loading || !candidates.length} onChange={(event) => setSelected((current) => event.target.checked
        ? [...new Set([...current, ...candidates.map((item) => item.value)])]
        : current.filter((value) => !candidates.some((item) => item.value === value)))}>全选</Checkbox>
    {hasMore && <Typography.Text type="secondary">候选值较多，请输入关键词搜索</Typography.Text>}
    <div className="kdos-column-menu-candidates">
      <Checkbox checked={selected.includes(EMPTY)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, EMPTY] : current.filter((value) => value !== EMPTY))}>未填写</Checkbox>
      {candidates.map((item) => <Checkbox key={item.value} checked={selected.includes(item.value)}
        onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, item.value])] : current.filter((value) => value !== item.value))}>{item.label}</Checkbox>)}
    </div>
  </> : <>
    <Select value={typedRule.operator} style={{ width: "100%" }} options={visibleOperators(field).map((operator) => ({ value: operator.operator, label: operator.label }))}
      onChange={(operator) => setTypedRule({ field: field.key, operator: operator as TableFilterOperator })} />
    <RuleValue resource={resource} field={field} operator={typedRule.operator} rule={typedRule}
      onChange={(patch) => setTypedRule((current) => ({ ...current, ...patch }))} />
  </>;
  const panel = <div className="kdos-column-menu-panel" data-testid={`column-menu-${field.key}`}>
    {filterOpen ? <>
      <Typography.Text strong>筛选：{field.label}</Typography.Text>
      {filterPanel}
      <Space style={{ justifyContent: "flex-end", width: "100%" }}>
        <Button onClick={() => { onFilter([]); finish(); }}>清空</Button>
        <Button type="primary" onClick={apply}>确定</Button>
      </Space>
    </> : <>
      <Button type="text" icon={<ArrowUpOutlined />} onClick={() => { onSort("ascend"); finish(); }}>升序</Button>
      <Button type="text" icon={<ArrowDownOutlined />} onClick={() => { onSort("descend"); finish(); }}>降序</Button>
      {sortOrder && <Button type="text" onClick={() => { onSort(undefined); finish(); }}>取消排序</Button>}
      <Divider style={{ margin: "4px 0" }} />
      <Button type="text" icon={<PushpinOutlined />} disabled={systemFixed} onClick={() => { onPin(); finish(); }}>
        {systemFixed ? "系统固定" : pinned ? "取消冻结" : "冻结到左侧"}
      </Button>
      <Button type="text" onClick={() => { onHide(); finish(); }}>隐藏此列</Button>
      <Divider style={{ margin: "4px 0" }} />
      <Button type="text" icon={<FilterOutlined />} disabled={!filterable || !isTableFieldFilterable(field)} onClick={() => setFilterOpen(true)}>
        {filterable && isTableFieldFilterable(field) ? "筛选" : "筛选（暂不支持）"}
      </Button>
    </>}
  </div>;
  return <span className="kdos-column-title">
    <span className="kdos-column-title-label">{title}</span>
    {sortOrder && <span className="kdos-column-state" aria-label={sortOrder === "ascend" ? "已按升序排序" : "已按降序排序"}>{sortOrder === "ascend" ? "↑" : "↓"}</span>}
    {filtered && <FilterOutlined className="kdos-column-state" aria-label="列头筛选已生效" />}
    <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={panel}>
      <button type="button" className="kdos-column-menu-trigger" aria-label={`${field.label}列菜单`} aria-expanded={open}>
        <MoreOutlined />
      </button>
    </Popover>
  </span>;
}
