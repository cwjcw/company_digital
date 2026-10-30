import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  computePrintLayout, normalizePrintPreferences, orderedPrintHeaderGroups, printPreferenceKey,
  PRINT_MARGIN_MM, PRINT_MAX_COLUMN_MM, PRINT_MIN_COLUMN_MM, PRINT_PX_PER_MM,
  type PrintPreferences
} from "@kdos/contracts";
import { fetchPrintDto, planPrint, printConfirmMessage, type TablePrintDto, type TablePrintRequest } from "./table-print";
import { KdosPrintDocument } from "./table-print-document";

type PageRange = { start: number; end: number };
type Pagination = { pages: PageRange[]; error?: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试";

/** Measures real browser table rows in bounded batches; preview and print use these same page ranges. */
function usePrintPagination(dto: TablePrintDto, widths: Record<string, number>, contentHeight: number, blocked: boolean) {
  const template = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<Pagination | null>(null);
  useEffect(() => {
    if (blocked || !template.current) return;
    let cancelled = false;
    let measuring: HTMLElement | undefined;
    const measure = async () => {
      await document.fonts?.ready;
      if (cancelled || !template.current) return;
      measuring = template.current.cloneNode(true) as HTMLElement;
      measuring.removeAttribute("aria-hidden");
      document.body.appendChild(measuring);
      const table = measuring.querySelector("table");
      if (!table) { setResult({ pages: [] }); return; }
      const tbody = table.tBodies[0]!;
      const fixedHeight = measuring.querySelector(".kdos-print-header")!.getBoundingClientRect().height
        + table.tHead!.getBoundingClientRect().height + 14; // Includes header gap and collapsed-border rounding.
      const capacity = contentHeight * PRINT_PX_PER_MM - fixedHeight;
      const pages: PageRange[] = [];
      let start = 0, used = 0;
      for (let offset = 0; offset < dto.rows.length; offset += 200) {
        if (cancelled) return;
        const fragment = document.createDocumentFragment();
        for (const row of dto.rows.slice(offset, offset + 200)) {
          const tr = document.createElement("tr");
          for (const column of dto.columns) {
            const td = document.createElement("td");
            td.className = `kdos-print-align-${column.align}`;
            td.textContent = row[column.key] ?? "—";
            tr.appendChild(td);
          }
          fragment.appendChild(tr);
        }
        tbody.replaceChildren(fragment);
        const rows = Array.from(tbody.rows);
        for (let index = 0; index < rows.length; index++) {
          const height = rows[index]!.getBoundingClientRect().height + 0.25;
          if (height > capacity || capacity <= 0) {
            setResult({ pages: [], error: "单行内容超过一页可用高度，请增加列宽、改用 A3 或减少长文本字段。" });
            return;
          }
          const position = offset + index;
          if (used + height > capacity && position > start) {
            pages.push({ start, end: position }); start = position; used = 0;
          }
          used += height;
        }
        // Yield between batches without omitting any rows from the final document.
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
      if (start < dto.rows.length) pages.push({ start, end: dto.rows.length });
      if (!cancelled) setResult({ pages });
    };
    void measure().catch(error => { if (!cancelled) setResult({ pages: [], error: errorMessage(error) }); }).finally(() => measuring?.remove());
    return () => { cancelled = true; measuring?.remove(); };
  }, [dto, widths, contentHeight, blocked]);
  return { template, result };
}

function PaginatedPreview({ dto, preferences, onResize, onReady, onProblem, printAll }: {
  dto: TablePrintDto; preferences: PrintPreferences;
  onResize: (key: string, event: MouseEvent<HTMLButtonElement>) => void;
  onReady: (ready: boolean) => void; onProblem: (message: string) => void; printAll: boolean;
}) {
  const layout = useMemo(() => computePrintLayout(dto.columns, preferences), [dto.columns, preferences]);
  const [page, setPage] = useState(0);
  // Reserve a footer inside the physical printable area; no font-size scaling.
  const contentHeight = layout.paper.height - PRINT_MARGIN_MM * 2 - 6;
  const { template, result } = usePrintPagination(dto, layout.widths, contentHeight, layout.overflow || !dto.columns.length);
  const ready = Boolean(result?.pages.length && !result.error && !layout.overflow);
  useEffect(() => { onReady(ready); return () => onReady(false); }, [ready, onReady]);
  useEffect(() => { if (result?.error) onProblem(result.error); }, [result?.error, onProblem]);
  const ranges = result?.pages ?? [];
  const currentPage = Math.min(page, Math.max(0, ranges.length - 1));
  const visiblePages = printAll ? ranges.map((range, index) => ({ range, index }))
    : ranges[currentPage] ? [{ range: ranges[currentPage]!, index: currentPage }] : [];
  return <>
    <div className="kdos-print-page-navigation">
      <button type="button" disabled={currentPage === 0 || !ready || printAll} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span>{ready ? `第 ${currentPage + 1} / ${ranges.length} 页 · 共 ${dto.rows.length} 条` : "正在计算分页…"}</span>
      <button type="button" disabled={currentPage >= ranges.length - 1 || !ready || printAll} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </div>
    {result?.error && <p role="alert">{result.error}</p>}
    <div ref={template} className="kdos-print-measure" aria-hidden="true" style={{ width: `${layout.availableWidth}mm` }}>
      <KdosPrintDocument dto={{ ...dto, rows: dto.rows.slice(0, 1) }} widths={layout.widths} />
    </div>
    <div className="kdos-print-pages" data-testid="kdos-print-pages">
      {visiblePages.map(({ range, index }) => <section key={index} className="kdos-print-paper" style={{
        width: `${layout.paper.width}mm`, height: `${layout.paper.height}mm`, padding: `${PRINT_MARGIN_MM}mm`
      }} data-page-number={index + 1}>
        <div className="kdos-print-page-content" style={{ height: `${contentHeight}mm` }}>
          <KdosPrintDocument dto={{ ...dto, rows: dto.rows.slice(range.start, range.end) }} widths={layout.widths} onResize={printAll ? undefined : onResize} />
        </div>
        <div className="kdos-print-page-number">第 {index + 1} / {ranges.length} 页</div>
      </section>)}
    </div>
  </>;
}

export function PrintSettingsPreview({ dto, request, onClose }: { dto: TablePrintDto; request: TablePrintRequest; onClose: () => void }) {
  const [data, setData] = useState(dto);
  const defaults = useMemo<PrintPreferences>(() => {
    const allowed = new Set(dto.columns.map(column => column.key));
    return { version: 1, columnKeys: (request.columnKeys ?? dto.columns.map(column => column.key)).filter(key => allowed.has(key)),
      widths: {}, paperSize: "A4", orientation: dto.meta.orientation, widthMode: "fit" };
  }, [dto, request.columnKeys]);
  const storageKey = useMemo(() => {
    // Same session identity as table preferences; no token, rows or names are persisted.
    let session: { tenantId?: string; tenantCode?: string; sub?: string } = {};
    try { session = JSON.parse(localStorage.getItem("sessionUser") ?? "{}") ?? {}; } catch { /* Same fallback as table preferences. */ }
    const scope = request.preferenceScope ?? { tenantKey: String(session.tenantId ?? session.tenantCode ?? "KAINAN"), userKey: String(session.sub ?? "anonymous") };
    return printPreferenceKey(scope.tenantKey, scope.userKey, request.resource, request.viewKey);
  }, [request]);
  const [preferences, setPreferences] = useState<PrintPreferences>(() => {
    try { return normalizePrintPreferences(JSON.parse(localStorage.getItem(storageKey) ?? "null"), dto.columns.map(column => column.key), defaults); }
    catch { return defaults; }
  });
  const [notice, setNotice] = useState(dto.meta.requestedCount != null && dto.meta.printedCount < dto.meta.requestedCount
    ? "部分已选记录因权限或状态变化未包含在打印内容中，请核对预览。" : "");
  const [busy, setBusy] = useState(false);
  const [printAll, setPrintAll] = useState(false);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const updateReady = useCallback((value: boolean) => { readyRef.current = value; setReady(value); }, []);
  const paginationProblem = useCallback((message: string) => {
    setNotice(message); setBusy(false); setPrintAll(false); busyRef.current = false;
  }, []);
  const resizeCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanup.current?.(), []);
  const selected = useMemo(() => {
    const byKey = new Map(data.columns.map(column => [column.key, column]));
    const columns = preferences.columnKeys.flatMap(key => byKey.has(key) ? [byKey.get(key)!] : []);
    return { ...data, columns, headerGroups: orderedPrintHeaderGroups(columns.map(column => column.key), data.headerGroups),
      meta: { ...data.meta, orientation: preferences.orientation } };
  }, [data, preferences]);
  const layout = useMemo(() => computePrintLayout(selected.columns, preferences), [selected.columns, preferences]);
  const orderedFields = [...selected.columns, ...data.columns.filter(column => !preferences.columnKeys.includes(column.key))];
  const paginationKey = `${revision}:${JSON.stringify(preferences)}`;
  const busyRef = useRef(false);
  useEffect(() => {
    const style = document.createElement("style");
    // Explicit pages include their own margins. Named legacy @page rules are not used.
    style.textContent = `@page { size: ${preferences.paperSize} ${preferences.orientation}; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [preferences.paperSize, preferences.orientation]);
  useEffect(() => {
    const afterPrint = () => { setPrintAll(false); setBusy(false); busyRef.current = false; };
    window.addEventListener("afterprint", afterPrint);
    return () => window.removeEventListener("afterprint", afterPrint);
  }, []);
  const change = (next: PrintPreferences) => { if (JSON.stringify(next) === JSON.stringify(preferences)) return; readyRef.current = false; setReady(false); setPreferences(next); setNotice(""); };
  const setWidth = (key: string, width: number) => {
    const widths = { ...layout.widths, [key]: Math.min(PRINT_MAX_COLUMN_MM, Math.max(PRINT_MIN_COLUMN_MM, width)) };
    change({ ...preferences, widthMode: "custom", widths });
  };
  const resize = (key: string, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const start = event.clientX, initial = layout.widths[key] ?? PRINT_MIN_COLUMN_MM;
    const widths = { ...layout.widths };
    let lastLayout = JSON.stringify(preferences);
    const move = (mouse: globalThis.MouseEvent) => {
      const next = { ...preferences, widthMode: "custom" as const, widths: { ...widths,
        [key]: Math.min(PRINT_MAX_COLUMN_MM, Math.max(PRINT_MIN_COLUMN_MM, initial + (mouse.clientX - start) / PRINT_PX_PER_MM)) } };
      const serialized = JSON.stringify(next);
      if (lastLayout === serialized) return;
      lastLayout = serialized;
      readyRef.current = false; setReady(false); setPreferences(next);
    };
    const stop = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", stop); resizeCleanup.current = null; };
    resizeCleanup.current?.(); resizeCleanup.current = stop;
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", stop);
  };
  const moveField = (from: string, to: string) => {
    if (from === to || !preferences.columnKeys.includes(from) || !preferences.columnKeys.includes(to)) return;
    const keys = preferences.columnKeys.filter(key => key !== from);
    keys.splice(keys.indexOf(to), 0, from); change({ ...preferences, columnKeys: keys });
  };
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      if (localStorage.getItem(storageKey) !== JSON.stringify(preferences)) throw new Error("存储校验失败");
      setNotice("已保存为我的默认打印配置（当前浏览器）。");
    } catch { setNotice("保存失败，浏览器存储不可用或空间不足。当前配置仍可用于本次打印。"); }
  };
  const print = async () => {
    if (busyRef.current || !readyRef.current || layout.overflow || !selected.columns.length) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      const { manifest } = await planPrint(request);
      if (manifest.total > data.rows.length && manifest.total > manifest.confirmThreshold && !window.confirm(printConfirmMessage(manifest))) {
        setBusy(false); busyRef.current = false; return;
      }
      const fresh = await fetchPrintDto({ ...request, columnKeys: undefined });
      const allowed = new Set(fresh.columns.map(column => column.key));
      const returned = selected.columns.map(column => column.key).filter(key => allowed.has(key));
      if (!fresh.rows.length) throw new Error("当前范围已无可打印数据，请关闭后重新查询。");
      if (JSON.stringify(returned) !== JSON.stringify(selected.columns.map(column => column.key))) {
        // A revoked field is removed immediately; re-open to load the current allowed field catalogue.
        setData(fresh);
        change(normalizePrintPreferences({ ...preferences, columnKeys: returned }, returned, defaults));
        throw new Error("字段权限已变化，已移除无权字段，请核对预览后重新打印。");
      }
      if (fresh.meta.requestedCount != null && fresh.meta.printedCount < fresh.meta.requestedCount && fresh.meta.printedCount !== data.meta.printedCount) {
        setData(fresh); setRevision(value => value + 1);
        throw new Error("部分已选记录因权限或状态变化未包含在打印内容中，请核对预览后重新打印。");
      }
      // Use current authorized values and metadata for BOTH preview and actual print.
      setData(fresh); setRevision(value => value + 1); readyRef.current = false; setReady(false);
      setPrintAll(true);
    } catch (error) { setNotice(errorMessage(error)); setBusy(false); busyRef.current = false; }
  };
  useEffect(() => {
    if (!printAll || !ready) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      try { window.print(); }
      catch (error) { setNotice(errorMessage(error)); }
      finally { setPrintAll(false); setBusy(false); busyRef.current = false; }
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [printAll, ready]);
  return <div className="kdos-print-preview" role="dialog" aria-modal="true" aria-label="打印设置与预览" data-testid="kdos-print-preview">
    <div className="kdos-print-preview-bar">
      <strong>打印设置与预览</strong>
      <span className="kdos-print-preview-hint">{dto.title} · {dto.meta.rangeType === "SELECTED" ? "打印已选" : "打印筛选结果"} · 共 {data.rows.length} 条</span>
      <button type="button" disabled={busy || !selected.columns.length || layout.overflow} onClick={save}>保存为我的默认配置</button>
      <button type="button" disabled={busy} onClick={() => change({ ...defaults, columnKeys: defaults.columnKeys.filter(key => data.columns.some(column => column.key === key)) })}>恢复默认</button>
      <button type="button" className="kdos-print-primary" disabled={busy || !ready || layout.overflow || !selected.columns.length} onClick={() => void print()}>{busy ? "正在准备打印…" : "本次打印"}</button>
      <button type="button" disabled={busy} onClick={onClose}>关闭</button>
    </div>
    {notice && <div className="kdos-print-notice" role="status">{notice}</div>}
    {!printAll && <div className="kdos-print-native-warning">请使用打印设置中的“本次打印”按钮，生成完整的获权打印文档。</div>}
    <div className={`kdos-print-workspace${printAll ? " kdos-print-prepared" : ""}`}>
      <fieldset className="kdos-print-settings" disabled={busy}>
        <legend>打印配置</legend>
        <div className="kdos-print-page-settings">
          <label>纸张大小<select aria-label="纸张大小" value={preferences.paperSize} onChange={e => change({ ...preferences, paperSize: e.target.value as "A4" | "A3" })}><option>A4</option><option>A3</option></select></label>
          <label>打印方向<select aria-label="打印方向" value={preferences.orientation} onChange={e => change({ ...preferences, orientation: e.target.value as "portrait" | "landscape" })}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
          <label>列宽适配<select aria-label="列宽适配" value={preferences.widthMode} onChange={e => change({ ...preferences, widthMode: e.target.value as "fit" | "custom" })}><option value="fit">自动适应纸张宽度</option><option value="custom">保持自定义宽度</option></select></label>
        </div>
        <p>拖动已选字段调整顺序；列宽单位：毫米（最小 {PRINT_MIN_COLUMN_MM} mm）。</p>
        <p>打印设置独立于表格字段显示；默认配置保存在当前浏览器。</p>
        {!selected.columns.length && <p role="alert">请至少选择一个打印字段。</p>}
        {layout.overflow && <p role="alert">列宽 {layout.totalWidth.toFixed(1)} mm 超过可用宽度 {layout.availableWidth} mm，无法打印。请选择自动适应、横向或 A3，或缩小列宽、减少字段。</p>}
        <ol className="kdos-print-fields" aria-label="打印字段">
          {orderedFields.map(column => {
            const checked = preferences.columnKeys.includes(column.key);
            return <li key={column.key} data-field-key={column.key} draggable={checked}
              onDragStart={e => e.dataTransfer.setData("text/plain", column.key)}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); moveField(e.dataTransfer.getData("text/plain"), column.key); }}>
              <div className="kdos-print-field-title"><span aria-hidden="true">⠿</span><label><input type="checkbox" checked={checked} onChange={e => change({ ...preferences, columnKeys: e.target.checked ? [...preferences.columnKeys, column.key] : preferences.columnKeys.filter(key => key !== column.key) })} />{column.label}</label></div>
              {checked && <div className="kdos-print-field-width">
                <button type="button" aria-label={`上移${column.label}`} disabled={preferences.columnKeys.indexOf(column.key) === 0} onClick={() => moveField(column.key, preferences.columnKeys[preferences.columnKeys.indexOf(column.key) - 1]!)}>↑</button>
                <label><input type="checkbox" aria-label={`${column.label}自动列宽`} checked={preferences.widths[column.key] == null} onChange={e => {
                  if (e.target.checked) { const widths = { ...preferences.widths }; delete widths[column.key]; change({ ...preferences, widths }); }
                  else setWidth(column.key, layout.widths[column.key] ?? PRINT_MIN_COLUMN_MM);
                }} />自动</label>
                <input type="number" aria-label={`${column.label}列宽（毫米）`} min={PRINT_MIN_COLUMN_MM} max={PRINT_MAX_COLUMN_MM} step="0.5" value={Number((layout.widths[column.key] ?? PRINT_MIN_COLUMN_MM).toFixed(1))} onChange={e => { if (e.target.value && Number.isFinite(e.target.valueAsNumber)) setWidth(column.key, e.target.valueAsNumber); }} /><span>mm</span>
              </div>}
            </li>;
          })}
        </ol>
      </fieldset>
      <main className="kdos-print-preview-area" aria-label="实时纸张预览" aria-busy={busy}>
        {selected.columns.length > 0 && <PaginatedPreview key={paginationKey} dto={selected} preferences={preferences} onResize={resize} onReady={updateReady} onProblem={paginationProblem} printAll={printAll} />}
      </main>
    </div>
  </div>;
}
