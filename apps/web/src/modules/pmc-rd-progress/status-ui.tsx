import { Tag, Tooltip } from "antd";
import { readable, type ProgressRow } from "./rd-progress.model";
import { routingSources, statusMeta } from "./rd-progress.constants";

export function StatusTag({ value, field = "rdStatus" }: { value: unknown; field?: string }) {
  const meta = statusMeta(value, field);
  return <Tag color={meta.tone}>{meta.label}</Tag>;
}
export function ComponentTag({ row, field }: { row: ProgressRow; field: "designBomStatus" | "routingStatus" }) {
  const keys = field === "designBomStatus" ? ["bomVersion", "bomECode", "bomApproveStatus", "validBomDetailCount"] : ["routingCode", "validOperationCount", "routingSource"];
  const labels: Record<string, string> = { bomVersion: "BOM版本", bomECode: "BOM E_CODE", bomApproveStatus: "原始审核状态", validBomDetailCount: "有效BOM明细数", routingCode: "路线编码", validOperationCount: "有效工序数", routingSource: "路线来源" };
  const visible = keys.filter(readable);
  return <Tooltip title={visible.length ? <div>{visible.map(key => <div key={key}>{labels[key]}：{key === "routingSource" ? routingSources[String(row[key])] ?? "—" : String(row[key] ?? "—")}</div>)}</div> : undefined}><span><StatusTag field={field} value={row[field]} /></span></Tooltip>;
}
