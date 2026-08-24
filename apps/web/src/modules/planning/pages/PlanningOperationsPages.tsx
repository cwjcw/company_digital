import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Input, message, Space, Table } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { api } from "../../../api";
import { InlineText, PageHeader } from "../../../shared/legacy-ui";
import { DUE_DATE_DISPLAY_FORMAT } from "../../../shared/date-format";

export function WeeklyPlanPage({ startDate }: { startDate: string }) {
  const queryClient = useQueryClient(); const [search, setSearch] = useState("");
  const periods = useQuery({ queryKey: ["weekly-plan-periods"], queryFn: () => api<any[]>("/planning-operations/weekly-periods") });
  const period = periods.data?.find((row) => row.startDate === startDate);
  const rows = useQuery({ queryKey: ["weekly-plan-items", period?.id, search], enabled: Boolean(period?.id), queryFn: () => api<any[]>(`/planning-operations/weekly-periods/${period.id}/items?search=${encodeURIComponent(search)}`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["weekly-plan-items", period?.id] });
  const sync = async () => { if (!period) return; const result = await api<{ synced: number }>(`/planning-operations/weekly-periods/${period.id}/sync-order-schedules`, { method: "POST" }); message.success(`已同步 ${result.synced} 条未完成订单`); refresh(); };
  const update = async (row: any, field: string, value: unknown) => { try { await api(`/planning-operations/weekly-items/${row.id}`, { method: "PATCH", body: JSON.stringify({ field, value, expectedVersion: row.version }) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const columns = [
    { title: "客户代码", dataIndex: "customerCode", width: 140 }, { title: "订单编号", dataIndex: "orderNumber", width: 170 },
    { title: "品项编码", dataIndex: "itemNumber", width: 170 }, { title: "品项名称", dataIndex: "itemName", width: 260 },
    { title: "订单总数量", dataIndex: "orderTotalQuantity", width: 140 }, { title: "生产单位", dataIndex: "productionUnit", width: 160 },
    { title: "订单完成比例", dataIndex: "completionRatio", width: 150, render: (value: unknown) => `${Number(value ?? 0).toFixed(2)}%` },
    { title: "客户交期", dataIndex: "customerDueDate", width: 140, render: (value: unknown, row: any) => <InlineText type="date" dateDisplayFormat={DUE_DATE_DISPLAY_FORMAT} value={value} onSave={(next) => update(row, "customerDueDate", next)} /> },
    { title: "评审交期", dataIndex: "reviewDueDate", width: 140, render: (value: unknown, row: any) => <InlineText type="date" dateDisplayFormat={DUE_DATE_DISPLAY_FORMAT} value={value} onSave={(next) => update(row, "reviewDueDate", next)} /> }
  ];
  return <div><PageHeader title={`${period?.name ?? "周计划"}（${startDate}）`} subtitle={period ? `${period.startDate} 至 ${period.endDate}；仅从订单排期同步完成比例小于 100% 的记录` : "正在加载周计划周期"} actions={<Space>
    <Input.Search allowClear placeholder="搜索客户、订单、品项、生产单位" onSearch={setSearch} style={{ width: 320 }} /><Button type="primary" disabled={!period} onClick={() => void sync()}>从订单排期同步</Button>
  </Space>} /><Table rowKey="id" loading={periods.isLoading || rows.isLoading} dataSource={rows.data} columns={columns} pagination={{ pageSize: 50, showTotal: (total) => `共 ${total} 条` }} scroll={{ x: "max-content", y: "calc(100vh - 250px)" }} /></div>;
}

export function WorkReportsPage() {
  const queryClient = useQueryClient(); const [date, setDate] = useState<Dayjs>(dayjs()); const [search, setSearch] = useState("");
  const dateValue = date.format("YYYY-MM-DD");
  const rows = useQuery({ queryKey: ["work-reports", dateValue, search], queryFn: () => api<any[]>(`/planning-operations/work-reports?date=${dateValue}&search=${encodeURIComponent(search)}`) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["work-reports", dateValue] });
  const sync = async () => { const result = await api<{ synced: number }>("/planning-operations/work-reports/sync", { method: "POST", body: JSON.stringify({ date: dateValue }) }); message.success(`已从主计划同步 ${result.synced} 条；原报工数量保持不变`); refresh(); };
  const update = async (row: any, value: unknown) => { try { await api(`/planning-operations/work-reports/${row.id}`, { method: "PATCH", body: JSON.stringify({ reportedQuantity: value, expectedVersion: row.version }) }); refresh(); } catch (error) { message.error((error as Error).message); refresh(); throw error; } };
  const columns = [
    { title: "日期", dataIndex: "displayDate", width: 110 }, { title: "客户", dataIndex: "customer", width: 180 },
    { title: "订单编码", dataIndex: "orderNumber", width: 170 }, { title: "品项编码", dataIndex: "itemNumber", width: 170 },
    { title: "品名", dataIndex: "itemName", width: 260 }, { title: "需求数量", dataIndex: "requiredQuantity", width: 140 },
    { title: "报工数量", dataIndex: "reportedQuantity", width: 150, render: (value: unknown, row: any) => <InlineText type="number" value={value} onSave={(next) => update(row, next)} /> }
  ];
  return <div><PageHeader title="报工表" subtitle="日期显示为 YYMMDD；除报工数量外，其他字段均从主计划手工同步" actions={<Space>
    <DatePicker value={date} onChange={(value) => value && setDate(value)} allowClear={false} /><Input.Search allowClear placeholder="搜索客户、订单、品项" onSearch={setSearch} style={{ width: 280 }} /><Button type="primary" onClick={() => void sync()}>从主计划同步</Button>
  </Space>} /><Table rowKey="id" loading={rows.isLoading} dataSource={rows.data} columns={columns} pagination={{ pageSize: 50, showTotal: (total) => `共 ${total} 条` }} scroll={{ x: "max-content", y: "calc(100vh - 250px)" }} /></div>;
}
