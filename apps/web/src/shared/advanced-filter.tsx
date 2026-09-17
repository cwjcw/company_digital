/* eslint-disable react-refresh/only-export-components -- shared filter helpers are intentionally co-located with the component */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, DatePicker, InputNumber, Input, Popover, Select, Space, Tag, Typography } from "antd";
import { DeleteOutlined, FilterOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import {
  tableFilterDynamicDateOptions, tableFilterUiOperatorsFor,
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

/**
 * 正式 UI 只暴露已确认的操作符白名单（`tableFilterUiOperatorsFor`，KN-FILTER-001 §30）：
 * 隐藏 starts_with、count_*、数值 in/not_in 等内部能力，避免界面出现未确认的筛选方式。
 */
export function visibleOperators(field: TablePermissionFieldDefinition) {
  return tableFilterUiOperatorsFor(field);
}

/** Header Filter 默认操作符（仍来自正式 registry，只是按 §7 指定首选顺序）。 */
export function defaultOperatorFor(field: TablePermissionFieldDefinition): TableFilterOperator | undefined {
  const available = visibleOperators(field).map((entry) => entry.operator as TableFilterOperator);
  const preferred: TableFilterOperator[] = field.multiple
    ? ["contains_any", "is_empty", "is_not_empty"]
    : field.type === "text" ? ["contains", "eq", "is_empty"]
    : field.type === "boolean" ? ["eq", "is_true", "is_false"]
    : field.type === "number" ? ["eq", "between", "gte"]
    : field.type === "date" || field.type === "datetime" ? ["eq", "between", "dynamic"]
    : field.type === "attachment" ? ["is_empty", "is_not_empty"]
    : ["eq", "in", "is_not_empty"];
  return preferred.find((operator) => available.includes(operator)) ?? available[0];
}

type Candidate = { value: string; label: string };
const fieldLabel = (field: TablePermissionFieldDefinition) => field.label;

export function CandidateSelect({ resource, field, multiple, placeholder, onChange }: {
  resource: string; field: TablePermissionFieldDefinition; multiple: boolean; placeholder: string;
  onChange: (value: string | string[] | null) => void;
}) {
  const [options, setOptions] = useState<Candidate[]>(field.options ?? []);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const view = resource === "mps-process-reports" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "PENDING" ? "&view=PENDING" : "";
      /* 平台级筛选接口：所有正式业务表统一入口，不依赖任何模块专用 URL。 */
      const found = await api<Candidate[]>(`/table-filters/candidates?resource=${encodeURIComponent(resource)}&field=${encodeURIComponent(field.key)}&limit=50&search=${encodeURIComponent(search)}${view}`);
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

/**
 * 时长字段正式输入：业务用户按“小时 + 分钟”填写，服务端仍比较整数分钟。
 * 例如 10 小时 30 分钟 → 630；BETWEEN 8 小时 0 分钟 ~ 10 小时 30 分钟 → 480 ~ 630。
 */
export function DurationInput({ value, onChange }: { value: unknown; onChange: (next: number | undefined) => void }) {
  const total = value == null || value === "" ? undefined : Math.max(0, Number(value) || 0);
  const hours = total == null ? undefined : Math.floor(total / 60);
  const minutes = total == null ? undefined : total % 60;
  const combine = (nextHours: number | null | undefined, nextMinutes: number | null | undefined) =>
    onChange(Math.max(0, Number(nextHours ?? 0)) * 60 + Math.min(59, Math.max(0, Number(nextMinutes ?? 0))));
  return <Space size={4}>
    <InputNumber min={0} precision={0} value={hours ?? null} placeholder="小时" addonAfter="小时" style={{ width: 110 }}
      onChange={(next) => combine(next, minutes ?? 0)} />
    <InputNumber min={0} max={59} precision={0} value={minutes ?? null} placeholder="分钟" addonAfter="分钟" style={{ width: 110 }}
      onChange={(next) => combine(hours ?? 0, next)} />
  </Space>;
}

/** 百分比字段正式输入：界面按 0..100 显示，提交前换算为存储值（80% → 0.8）。 */
export function PercentageInput({ value, onChange }: { value: unknown; onChange: (next: number | undefined) => void }) {
  const display = value == null || value === "" ? undefined : Number(value) * 100;
  return <InputNumber min={0} max={100} precision={2} value={display === undefined || Number.isNaN(display) ? null : display}
    addonAfter="%" style={{ width: 130 }} onChange={(next) => onChange(next == null ? undefined : Number(next) / 100)} />;
}

/**
 * KN-FILTER-003：date 与 datetime 的正式序列化格式。
 * - date 只表示自然日：`YYYY-MM-DD`；
 * - datetime 表示具体业务时间点（UI 精度到秒）：`YYYY-MM-DD HH:mm:ss`，**绝不允许**格式化成 `YYYY-MM-DD` 丢时间。
 * 业务时区固定为 Asia/Shanghai：这里序列化的是用户看到的上海墙上时间，时区换算由服务端按 `+08:00` 显式完成，
 * 前端不做 `toISOString()` 隐式偏移，也不依赖浏览器本地时区。
 */
export const FILTER_DATE_FORMAT = "YYYY-MM-DD";
export const FILTER_DATETIME_FORMAT = "YYYY-MM-DD HH:mm:ss";
export function serializeTemporalFilterValue(field: TablePermissionFieldDefinition, value: Dayjs | null | undefined) {
  if (!value) return undefined;
  return value.format(field.type === "datetime" ? FILTER_DATETIME_FORMAT : FILTER_DATE_FORMAT);
}

/** 时间字段正式输入：date 用普通日期选择；datetime 用带秒的时间选择，回显完整 `YYYY-MM-DD HH:mm:ss`。 */
export function TemporalInput({ field, value, onChange }: {
  field: TablePermissionFieldDefinition; value: unknown; onChange: (next: string | undefined) => void;
}) {
  const isDatetime = field.type === "datetime";
  return <DatePicker
    showTime={isDatetime ? { format: "HH:mm:ss" } : false}
    format={isDatetime ? FILTER_DATETIME_FORMAT : FILTER_DATE_FORMAT}
    value={value ? dayjs(String(value)) : null}
    onChange={(next) => onChange(serializeTemporalFilterValue(field, next))}
  />;
}

export function RuleValue({ resource, field, operator, rule, onChange }: {
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
      ? <TemporalInput field={field} value={value} onChange={(next) => onChange({ [key]: next } as Partial<AdvancedFilterRule>)} />
      : field.format === "durationMinutes" ? <DurationInput value={value} onChange={(next) => onChange({ [key]: next } as Partial<AdvancedFilterRule>)} />
      : field.format === "percentage" ? <PercentageInput value={value} onChange={(next) => onChange({ [key]: next } as Partial<AdvancedFilterRule>)} />
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
    return <TemporalInput field={field} value={rule.value} onChange={(next) => onChange({ value: next })} />;
  }
  if (field.type === "number") {
    if (field.format === "durationMinutes") return <DurationInput value={rule.value} onChange={(next) => onChange({ value: next })} />;
    if (field.format === "percentage") return <PercentageInput value={rule.value} onChange={(next) => onChange({ value: next })} />;
    return <InputNumber value={rule.value as number} onChange={(next) => onChange({ value: next ?? undefined })} style={{ width: 140 }}
      addonAfter={undefined} />;
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
    /* 使用文档化的默认操作符（文本=包含、日期=等于、数值=等于、多值=包含任意一个）。 */
    const operator = field ? defaultOperatorFor(field) : undefined;
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
