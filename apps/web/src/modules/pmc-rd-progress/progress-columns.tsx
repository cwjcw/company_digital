import { Button, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { formatDateOnly } from "../../shared/date-format";
import { businessTime, canOpenOrder, readable, type ProgressRow } from "./rd-progress.model";
import { ComponentTag, StatusTag } from "./status-ui";

export function progressColumns(openOrder?: (row: ProgressRow) => void, openItem?: (row: ProgressRow) => void): ColumnsType<ProgressRow> {
  const text = (value: unknown) => String(value ?? "—");
  const columns: ColumnsType<ProgressRow> = [
    { title: "订单号", dataIndex: "orderNo", width: 220, fixed: "left", render: (value, row) => openOrder && canOpenOrder() && row.sourceOrderId ? <Button type="link" size="small" onClick={() => openOrder(row)}>{text(value)}</Button> : text(value) },
    ...(readable("customerName") ? [{ title: "客户", dataIndex: "customerName", width: 180, ellipsis: { showTitle: false }, render: (value: unknown, row: ProgressRow) => <Tooltip title={String(value || (readable("customerCode") && row.customerCode) || "—")}>{String(value || (readable("customerCode") && row.customerCode) || "—")}</Tooltip> }] : [{ title: "客户", dataIndex: "customerCode", width: 150 }]),
    { title: "事业部", dataIndex: "divisionId", width: 120, render: (_value, row) => readable("divisionName") ? row.divisionName || "未映射" : "—" },
    { title: "下单日期", dataIndex: "orderDate", width: 112, render: formatDateOnly },
    { title: "品项编码", dataIndex: "itemCode", width: 190, render: (value, row) => openItem ? <Button type="link" size="small" onClick={() => openItem(row)}>{text(value)}</Button> : text(value) },
    { title: "品项名称", dataIndex: "itemName", width: 200, ellipsis: { showTitle: false }, render: value => <Tooltip title={text(value)}>{text(value)}</Tooltip> },
    { title: "规格", dataIndex: "itemSpec", width: 160, ellipsis: { showTitle: false }, render: value => <Tooltip title={text(value)}>{text(value)}</Tooltip> },
    { title: "数量", dataIndex: "businessQty", width: 100, align: "right" },
    { title: "设计BOM状态", dataIndex: "designBomStatus", width: 126, render: (_value, row) => <ComponentTag row={row} field="designBomStatus" /> },
    { title: "工艺路线状态", dataIndex: "routingStatus", width: 126, render: (_value, row) => <ComponentTag row={row} field="routingStatus" /> },
    { title: "研发状态", dataIndex: "rdStatus", width: 148, render: value => <StatusTag value={value} /> },
    { title: "未完成原因", dataIndex: "reasonText", width: 300, ellipsis: { showTitle: false }, render: value => <Tooltip title={text(value)}>{text(value)}</Tooltip> },
    { title: "研发修改时间", dataIndex: "rdLastModifiedAt", width: 170, render: businessTime },
    { title: "订单修改时间", dataIndex: "orderLastModifiedDate", width: 170, render: businessTime }
  ];
  return columns.filter(column => readable(String("dataIndex" in column ? column.dataIndex : "")));
}

