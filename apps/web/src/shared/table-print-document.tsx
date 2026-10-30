/* eslint-disable react-refresh/only-export-components -- print timestamp formatting is shared with the document */
import type { TablePrintDto } from "./table-print";

/** Business timestamps always use Asia/Shanghai; never the browser timezone. */
export function formatPrintDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}


export function KdosPrintDocument({ dto, widths, onResize }: {
  dto: TablePrintDto; widths?: Record<string, number>;
  onResize?: (key: string, event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { meta } = dto;
  const scope = meta.rangeType === "SELECTED"
    ? `打印范围：已选，共 ${meta.printedCount} 条`
    : `打印范围：${meta.filtered || meta.searched ? "筛选结果" : "全部记录"}，共 ${meta.printedCount} 条`;
  return <div className={`kdos-print-root orientation-${meta.orientation}`} data-testid="kdos-print-root">
    <div className="kdos-print-header">
      <div className="kdos-print-platform">凯南数字化工作台</div>
      <div className="kdos-print-title">{dto.title}</div>
      <div className="kdos-print-meta">
        <span>打印时间：{formatPrintDateTime(meta.printedAt)}</span>
        <span>打印人：{meta.printedBy?.trim() || "—"}</span>
      </div>
      <div className="kdos-print-scope">{scope}</div>
    </div>
    {dto.rows.length
      ? <table style={widths ? { width: `${dto.columns.reduce((sum, column) => sum + (widths[column.key] ?? 0), 0)}mm` } : undefined} className="kdos-print-table" data-testid="kdos-print-table">
        <colgroup>{dto.columns.map(column => <col key={column.key} style={{ width: widths ? `${widths[column.key]}mm` : `${column.width / dto.columns.reduce((sum, item) => sum + item.width, 0) * 100}%` }} />)}</colgroup>
        <thead>
          {dto.headerGroups.length > 0 && <tr>
            {dto.headerGroups.map((group) => <th key={`${group.label}-${group.columns[0]}`} colSpan={group.columns.length}>{group.label}</th>)}
          </tr>}
          <tr>{dto.columns.map(column => <th key={column.key}>{column.label}
            {onResize && <button type="button" className="kdos-print-resize" aria-label={`调整${column.label}打印列宽`} onMouseDown={event => onResize(column.key, event)} />}
          </th>)}</tr>
        </thead>
        <tbody>
          {dto.rows.map((row, index) => <tr key={index}>
            {dto.columns.map((column) => <td key={column.key} className={`kdos-print-align-${column.align}`}>{row[column.key] ?? "—"}</td>)}
          </tr>)}
        </tbody>
      </table>
      : <div className="kdos-print-empty">当前没有可打印数据。</div>}
  </div>;
}
