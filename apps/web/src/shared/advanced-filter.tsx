/* eslint-disable react-refresh/only-export-components -- shared filter helpers are intentionally co-located with the component */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, DatePicker, InputNumber, Input, Popover, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, FilterOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import {
  tableFilterDynamicDateOptions, tableFilterOperatorsFor,
  type TableFilterOperator, type TablePermissionFieldDefinition
} from "@kdos/contracts";
import { api } from "../api";

export type AdvancedFilterRule = {
  field: string; operator: TableFilterOperator;
  value?: unknown; values?: unknown[]; min?: unknown; max?: unknown; dynamic?: string;
};
export type AdvancedFilterGroup = { logic: "AND" | "OR"; rules: AdvancedFilterRule[] };

export const emptyFilterGroup = (): AdvancedFilterGroup => ({ logic: "AND", rules: [] });

export function filterGroupRuleCount(group?: AdvancedFilterGroup | null) {
  return group?.rules?.length ?? 0;
}

/** 只暴露正式用户可见操作符（内部协议可能支持更多，但不自动出现在 UI）。 */
export function visibleOperators(field: TablePermissionFieldDefinition) {
  const allowed = tableFilterOperatorsFor(field);
  if (field.type === "attachment") return allowed.filter((entry) => entry.operator === "is_empty" || entry.operator === "is_not_empty");
  return allowed;
}

type Candidate = { value: string; label: string };
const fieldLabel = (field: TablePermissionFieldDefinition) => field.label;

function CandidateSelect({ resource, field, multiple, placeholder, onChange }: {
  resource: string; field: TablePermissionFieldDefinition; multiple: boolean; placeholder: string;
  onChange: (value: string | string[] | null) => void;
}) {
  const [options, setOptions] = useState<Candidate[]>(field.options ?? []);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const view = resource === "mps-process-reports" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "PENDING" ? "&view=PENDING" : "";
      const found = await api<Candidate[]>(`/master-plan-system/references/candidates?resource=${encodeURIComponent(resource)}&field=${encodeURIComponent(field.key)}&limit=50&search=${encodeURIComponent(search)}${view}`);
      setOptions(found ?? []);
    } catch { setOptions(field.options ?? []); }
    finally { setLoading(false); }
  }, [field, resource]);
  useEffect(() => { if (!field.options?.length) void load(""); }, [field.key, load, field.options?.length]);
  return <Select
    mode={multiple ? "multiple" : undefined} showSearch allowClear virtual={false} loading={loading}
    filterOption={false} onSearch={(search) => void load(search)} placeholder={placeholder}
    options={options.map((option) => ({ value: option.value, label: option.label }))}
    style={{ minWidth: 200, maxWidth: 320 }}
    onChange={(value) => onChange((value as string | string[]) ?? null)}
  />;
}

function RuleValue({ resource, field, operator, rule, onChange }: {
  resource: string; field: TablePermissionFieldDefinition; operator: string; rule: AdvancedFilterRule;
  onChange: (patch: Partial<AdvancedFilterRule>) => void;
}) {
  if (operator === "is_empty" || operator === "is_not_empty" || operator === "is_true" || operator === "is_false" || operator === "has_attachment" || operator === "has_no_attachment") {
    return <Typography.Text type="secondary">无需填写值</Typography.Text>;
  }
  if (operator === "dynamic") {
    return <Select value={rule.dynamic} placeholder="选择动态区间" style={{ minWidth: 160 }}
      options={tableFilterDynamicDateOptions.map((option) => ({ value: option.value, label: option.label }))}
      onChange={(value) => onChange({ dynamic: value })} />;
  }
  if (operator === "between") {
    const control = (key: "min" | "max", value: unknown) => field.type === "date" || field.type === "datetime"
      ? <DatePicker showTime={field.type === "datetime"} value={value ? dayjs(String(value)) : null} onChange={(next) => onChange({ [key]: next ? next.format("YYYY-MM-DD") : undefined } as Partial<AdvancedFilterRule>)} />
      : <InputNumber value={value as number} onChange={(next) => onChange({ [key]: next ?? undefined } as Partial<AdvancedFilterRule>)} style={{ width: 120 }} />;
    return <Space>{control("min", rule.min)}<Typography.Text type="secondary">至</Typography.Text>{control("max", rule.max)}</Space>;
  }
  if (operator === "in" || operator === "not_in" || operator === "contains_any" || operator === "contains_all" || operator === "not_contains_any") {
    return <CandidateSelect resource={resource} field={field} multiple placeholder="选择或搜索取值"
      onChange={(value) => onChange({ values: value == null ? [] : Array.isArray(value) ? value : [value] })} />;
  }
  if (field.type === "dictionary" || field.type === "member" || field.type === "department" || field.type === "reference" || field.type === "boolean") {
    if (field.type === "boolean") return <Select value={rule.value as string} style={{ minWidth: 100 }} options={[{ value: "true", label: "是" }, { value: "false", label: "否" }]}
      onChange={(value) => onChange({ value })} />;
    return <CandidateSelect resource={resource} field={field} multiple={false} placeholder="选择或搜索取值"
      onChange={(value) => onChange({ value: Array.isArray(value) ? value[0] : value ?? undefined })} />;
  }
  if (field.type === "date" || field.type === "datetime") {
    return <DatePicker showTime={field.type === "datetime"} value={rule.value ? dayjs(String(rule.value)) : null}
      onChange={(next) => onChange({ value: next ? next.format("YYYY-MM-DD") : undefined })} />;
  }
  if (field.type === "number") {
    return <InputNumber value={rule.value as number} onChange={(next) => onChange({ value: next ?? undefined })} style={{ width: 140 }}
      addonAfter={field.format === "percentage" ? "%" : field.format === "durationMinutes" ? "分钟" : undefined} />;
  }
  return <Input value={rule.value as string} placeholder="输入要匹配的内容" style={{ minWidth: 200, maxWidth: 320 }}
    onChange={(event) => onChange({ value: event.target.value })} onPressEnter={(event) => (event.target as HTMLInputElement).blur()} />;
}

/**
 * KN-FILTER-001 统一高级筛选 UI：草稿(draft) 与已应用(applied) 严格分离，
 * 操作符完全来自正式 registry（tableFilterOperatorsFor），值控件按字段类型/格式选择，
 * 切换字段或操作符时清除不兼容的操作数。
 */
export function KdosAdvancedFilter({ resource, fields, value, onApply, disabledFields = [] }: {
  resource: string;
  fields: TablePermissionFieldDefinition[];
  value: AdvancedFilterGroup;
  onApply: (group: AdvancedFilterGroup) => void;
  disabledFields?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilterGroup>(value);
  useEffect(() => { if (!open) setDraft(value); }, [value, open]);
  const selectable = useMemo(
    () => fields.filter((field) => field.filterable !== false && field.type !== "structured" && !disabledFields.includes(field.key) && visibleOperators(field).length > 0),
    [fields, disabledFields]
  );
  const appliedCount = filterGroupRuleCount(value);
  const update = (index: number, patch: Partial<AdvancedFilterRule>) =>
    setDraft((current) => ({ ...current, rules: current.rules.map((rule, itemIndex) => itemIndex === index ? { ...rule, ...patch } : rule) }));
  const changeField = (index: number, fieldKey: string) => {
    const field = selectable.find((candidate) => candidate.key === fieldKey);
    const operator = field ? visibleOperators(field)[0]?.operator : undefined;
    /* 字段变化必须清除不兼容的操作符与操作数。 */
    update(index, { field: fieldKey, operator: operator as TableFilterOperator, value: undefined, values: [], min: undefined, max: undefined, dynamic: undefined });
  };
  const changeOperator = (index: number, operator: TableFilterOperator) => update(index, { operator, value: undefined, values: [], min: undefined, max: undefined, dynamic: undefined });
  const apply = () => { onApply({ logic: draft.logic, rules: draft.rules.filter((rule) => rule.field && rule.operator) }); setOpen(false); };
  const clear = () => { const empty = emptyFilterGroup(); setDraft(empty); onApply(empty); setOpen(false); };

  const panel = <div className="kdos-advanced-filter" style={{ width: 620 }} data-testid="advanced-filter-panel">
    <Space size={8} wrap>
      <Typography.Text>筛选出符合以下</Typography.Text>
      <Select size="small" value={draft.logic} style={{ width: 92 }}
        options={[{ value: "AND", label: "所有" }, { value: "OR", label: "任一" }]}
        onChange={(logic) => setDraft((current) => ({ ...current, logic: logic as "AND" | "OR" }))} />
      <Typography.Text>条件的数据</Typography.Text>
    </Space>
    <Space direction="vertical" style={{ width: "100%", marginTop: 12 }} size={8}>
      {draft.rules.map((rule, index) => {
        const field = selectable.find((candidate) => candidate.key === rule.field);
        const operators = field ? visibleOperators(field) : [];
        return <Space key={`${index}-${rule.field}`} align="start" wrap>
          <Select value={rule.field || undefined} placeholder="选择字段" showSearch optionFilterProp="label" style={{ width: 190 }}
            options={selectable.map((candidate) => ({ value: candidate.key, label: fieldLabel(candidate) }))}
            onChange={(key) => changeField(index, key)} />
          <Select value={rule.operator || undefined} placeholder="选择条件" style={{ width: 150 }} disabled={!field}
            options={operators.map((entry) => ({ value: entry.operator, label: entry.label }))}
            onChange={(operator) => changeOperator(index, operator as TableFilterOperator)} />
          {field ? <RuleValue resource={resource} field={field} operator={String(rule.operator)} rule={rule} onChange={(patch) => update(index, patch)} /> : null}
          <Button type="text" danger icon={<DeleteOutlined />} aria-label="删除条件"
            onClick={() => setDraft((current) => ({ ...current, rules: current.rules.filter((_, itemIndex) => itemIndex !== index) }))} />
        </Space>;
      })}
      <Button type="dashed" icon={<PlusOutlined />} block
        onClick={() => setDraft((current) => ({ ...current, rules: [...current.rules, { field: "", operator: "eq" as TableFilterOperator }] }))}>
        添加过滤条件
      </Button>
    </Space>
    <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 12 }}>
      <Button onClick={clear}>清空</Button>
      <Button type="primary" onClick={apply}>筛选</Button>
    </Space>
  </div>;

  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) setDraft(value); }} trigger="click" placement="bottomLeft" content={panel}>
    <Badge count={appliedCount} size="small">
      <Button icon={<FilterOutlined />}>{appliedCount ? <Tag color="blue" style={{ marginInlineStart: 4 }}>{appliedCount} 条条件</Tag> : "高级筛选"}</Button>
    </Badge>
  </Popover>;
}
