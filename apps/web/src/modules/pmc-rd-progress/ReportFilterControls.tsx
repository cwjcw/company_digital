import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DatePicker, Select, Space, Typography } from "antd";
import dayjs from "dayjs";
import { api } from "../../api";
import { resource, sessionCacheScope } from "./rd-progress.model";
import { defaultPeriod, periodBounds, periodForMode, periodOptions, type ReportPeriod } from "./rd-progress.period";

/** Thin controlled Select over the existing permission-aware platform candidate API. */
export function ReportCandidateSelect({ field, label, value = "", onChange }: { field: "divisionId" | "customerName"; label: string; value?: string; onChange?: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [known, setKnown] = useState<Array<{ value: string; label: string }>>([]);
  useEffect(() => { const timer = setTimeout(() => setKeyword(search), 200); return () => clearTimeout(timer); }, [search]);
  const candidates = useQuery({ queryKey: [resource, sessionCacheScope(), "candidates", field, keyword], queryFn: ({ signal }) => api<{ options: Array<{ value: string; label: string }>; hasMore: boolean }>(`/table-filters/candidates?${new URLSearchParams({ resource, field, search: keyword, limit: "100", withMeta: "1" })}`, { signal }), staleTime: 300_000, retry: false });
  useEffect(() => { if (candidates.data) setKnown(previous => Array.from(new Map([...previous, ...candidates.data.options].map(option => [option.value, option])).values())); }, [candidates.data]);
  const options = candidates.data?.options ?? [];
  const selected = known.find(option => option.value === value);
  return <Select aria-label={label} allowClear showSearch value={value} loading={candidates.isPending} filterOption={false} onSearch={setSearch}
    onOpenChange={open => { if (!open) setSearch(""); }} onChange={next => onChange?.(next ?? "")}
    options={[{ value: "", label: "全部" }, ...(value && !options.some(option => option.value === value) ? [selected ?? { value, label: field === "customerName" ? value : "已选事业部" }] : []), ...options]}
    notFoundContent={candidates.error ? "选项加载失败" : undefined}
    popupRender={menu => <>{menu}{candidates.data?.hasMore && <Typography.Text type="secondary">候选值较多，请输入关键词搜索</Typography.Text>}{candidates.error && <Typography.Text type="danger">{label}选项加载失败：{candidates.error.message}</Typography.Text>}</>} />;
}

export function ReportPeriodPicker({ value = defaultPeriod(), onChange }: { value?: ReportPeriod; onChange?: (next: ReportPeriod) => void }) {
  const bounds = periodBounds(value)!;
  return <Space.Compact block>
    <Select aria-label="日期周期" style={{ width: 100, flexShrink: 0 }} value={value.mode} options={periodOptions} onChange={mode => onChange?.(periodForMode(mode, value))} />
    {value.mode === "custom" ? <DatePicker.RangePicker aria-label="自定义下单日期" allowClear={false} value={[dayjs(bounds.orderDateFrom), dayjs(bounds.orderDateTo)]} format="YYYY-MM-DD" onChange={dates => { if (dates?.[0] && dates[1]) onChange?.({ mode: "custom", value: `${dates[0].format("YYYY-MM-DD")},${dates[1].format("YYYY-MM-DD")}` }); }} />
      : <DatePicker aria-label="统计日期" allowClear={false} picker={value.mode === "day" ? "date" : value.mode} value={dayjs(bounds.orderDateFrom)} format={value.mode === "day" ? "YYYY-MM-DD" : value.mode === "month" ? "YYYY-MM" : "YYYY"} onChange={date => { if (date) onChange?.({ mode: value.mode, value: date.format(value.mode === "day" ? "YYYY-MM-DD" : value.mode === "month" ? "YYYY-MM" : "YYYY") }); }} />}
  </Space.Compact>;
}
