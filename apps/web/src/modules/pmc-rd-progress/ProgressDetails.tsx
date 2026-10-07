import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Modal, Space, Spin } from "antd";
import { api } from "../../api";
import { KdosDataTable } from "../../shared/KdosDataTable";
import { blankPlatformQuery, type PlatformTablePage } from "../../shared/platform-table";
import { formatDateOnly } from "../../shared/date-format";
import { businessTime, orderFilter, percentText, readable, reportUrl, resource, sessionCacheScope, type OrderProgress, type ProgressRow } from "./rd-progress.model";
import { progressColumns } from "./progress-columns";
import { StatusTag } from "./status-ui";
import { orderStatuses, routingSources } from "./rd-progress.constants";

export function OrderDrawer({ row, close }: { row: ProgressRow; close: () => void }) {
  const [query, setQuery] = useState(blankPlatformQuery());
  const sessionScope = sessionCacheScope();
  const group = orderFilter(String(row.sourceOrderId));
  const orders = useQuery({ queryKey: [resource, sessionScope, "order", row.sourceOrderId], queryFn: ({ signal }) => api<PlatformTablePage<OrderProgress>>(reportUrl("orders", {}, undefined, group), { signal }), retry: false });
  const items = useQuery({ queryKey: [resource, sessionScope, "order-items", row.sourceOrderId, query.page, query.pageSize], queryFn: ({ signal }) => api<PlatformTablePage<ProgressRow>>(reportUrl("items", {}, query, group), { signal }), retry: false });
  const lastTotal = useRef(0);
  if (items.data) lastTotal.current = items.data.total;
  const order = orders.data?.rows[0];
  return <Drawer open title={`订单研发详情 · ${row.orderNo ?? "—"}`} width="min(1200px, 96vw)" onClose={close}>
    <Descriptions size="small" column={3} items={[
      ...(readable("customerName") || readable("customerCode") ? [{ key: "customer", label: "客户", children: String(row.customerName || row.customerCode || "—") }] : []),
      ...(readable("divisionName") ? [{ key: "division", label: "事业部", children: String(row.divisionName || "未映射") }] : []),
      ...(readable("orderDate") ? [{ key: "date", label: "下单日期", children: formatDateOnly(row.orderDate) }] : [])
    ]} />
    {orders.isPending && <Spin aria-label="加载订单汇总" />}
    {orders.error && <Alert type="error" message="订单汇总加载失败" description={orders.error.message} action={<Button onClick={() => orders.refetch()}>重试</Button>} />}
    {order && <Descriptions size="small" column={3} items={[
      { key: "status", label: "订单研发状态", children: orderStatuses[order.orderRdStatus] ?? order.orderRdStatus },
      { key: "total", label: "总品项数", children: order.totalItemCount }, { key: "applicable", label: "适用品项数", children: order.applicableItemCount },
      { key: "complete", label: "已完成数", children: order.completeItemCount }, { key: "incomplete", label: "未完成数", children: order.incompleteItemCount },
      { key: "abnormal", label: "异常数", children: order.abnormalItemCount }, { key: "rate", label: "订单完成率", children: percentText(order.completionRate) }
    ]} />}
    {items.error && <Alert type="error" message="订单品项加载失败" description={items.error.message} action={<Button onClick={() => items.refetch()}>重试</Button>} />}
    <KdosDataTable<ProgressRow> resource={resource} viewKey="order-detail" simple systemFields={false} selectable={false} rowKey="id" columns={progressColumns()} dataSource={items.data?.rows ?? []} loading={items.isPending} serverData={{ total: items.data?.total ?? lastTotal.current, onQueryChange: setQuery }} internalVerticalScroll scroll={{ x: "max-content", y: 420 }} />
  </Drawer>;
}
export function ItemDetails({ row, close }: { row: ProgressRow; close: () => void }) {
  const keys: Array<[string, string]> = [["orderNo", "订单号"], ["itemCode", "品项编码"], ["itemName", "品项名称"], ["itemSpec", "规格"], ["businessQty", "数量"], ["itemProperty", "物料属性"], ["routingControl", "工艺控制"], ["bomVersion", "BOM版本"], ["bomECode", "BOM E_CODE"], ["bomApproveStatus", "BOM原始审核状态"], ["validBomDetailCount", "有效BOM明细数"], ["routingCode", "路线编码"], ["validOperationCount", "有效工序数"], ["routingSource", "路线来源"], ["reasonText", "原因说明"], ["rdLastModifiedAt", "研发修改时间"]];
  return <Modal open title="品项研发详情" onCancel={close} footer={<Button onClick={close}>关闭</Button>} width={760}>
    <Space wrap>{["designBomStatus", "routingStatus", "rdStatus"].filter(readable).map(field => <StatusTag key={field} value={row[field]} field={field} />)}</Space>
    <Descriptions style={{ marginTop: 16 }} column={2} items={keys.filter(([key]) => readable(key)).map(([key, label]) => ({ key, label, children: key === "rdLastModifiedAt" ? businessTime(row[key]) : key === "routingSource" ? routingSources[String(row[key])] ?? "—" : String(row[key] ?? "—") }))} />
  </Modal>;
}
