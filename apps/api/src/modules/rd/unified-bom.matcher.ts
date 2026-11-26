import { reliableApprovalDate, type BomReportState } from './rd-order-bom-report.calculator';

export const BOM_SOURCES = ['e10-main','tplus-kejia','tplus-kainan'] as const;
export type BomSource = typeof BOM_SOURCES[number];
export const BOM_SOURCE_NAMES: Record<BomSource,string> = { 'e10-main':'E10','tplus-kejia':'科加智能','tplus-kainan':'凯南智能' };
export type UnifiedBomHead = { source: BomSource; bomId: string; itemCode: string | null; version: string | null;
  approved: boolean; disabled: boolean; modifiedAt: string | null; auditedAt: string | null };

/** Only the exact code and effective status determine existence. Time is informational. */
export function createUnifiedBomMatcher(heads: UnifiedBomHead[], verified: boolean) {
  const byCode = new Map<string,UnifiedBomHead[]>();
  for (const h of heads) {
    if (!h.approved || h.disabled || h.itemCode == null) continue;
    const list = byCode.get(h.itemCode) ?? []; list.push(h); byCode.set(h.itemCode,list);
  }
  return (code: string) => {
    const found = byCode.get(code) ?? [];
    const sources = BOM_SOURCES.filter(source=>found.some(h=>h.source===source));
    const ambiguous = found.length > 1;
    const status: BomReportState['status'] = found.length ? 'HAS_BOM' : 'NO_BOM';
    const candidateTimes = sources.map(source=>{
      const times=found.filter(h=>h.source===source).map(h=>h.modifiedAt).filter((t):t is string=>!!t).sort();
      return `${BOM_SOURCE_NAMES[source]}：${times.at(-1)?.slice(0,10) ?? '未知'}`;
    }).join('；');
    const approvalDates = found.map(head=>reliableApprovalDate(head.auditedAt)).filter((value):value is string=>value!==null);
    const latestApprovalDate = approvalDates.sort((a,b)=>Date.parse(b)-Date.parse(a))[0] ?? null;
    return { status, approvalDate: latestApprovalDate,
      bomSources:sources.map(source=>BOM_SOURCE_NAMES[source]).join('、'), sourceModifiedTimes:candidateTimes,
      bomVerified:verified,
      bomSourceNote:ambiguous ? '存在多来源或多个有效版本；审核日期采用有效BOM头中最新的可靠审核时间。候选更新时间仅供参考。'
        : found.length ? '来源候选更新时间仅供参考，不代表最终来源仲裁。'
        : verified ? '三来源当前成功快照内未匹配有效BOM。' : '来源异常、过期或尚未核验；N不代表三来源均已确认无BOM。' };
  };
}

/** Internal analysis only; never used to choose an approval date or an existence result. */
export function simulateBomSource(heads: UnifiedBomHead[]) {
  const effective = heads.filter(h=>h.approved&&!h.disabled);
  const sources = BOM_SOURCES.filter(s=>effective.some(h=>h.source===s)).map(source=>{
    const rows=effective.filter(h=>h.source===source);
    return {source,count:rows.length,versions:rows.map(h=>h.version),candidateTimes:rows.map(h=>h.modifiedAt)};
  });
  if (sources.some(s=>s.count>1)) return {sources,latestSource:null,ambiguous:true,reason:'MULTIPLE_VERSIONS'};
  if (!effective.length || effective.some(h=>!h.modifiedAt || !Number.isFinite(Date.parse(h.modifiedAt)))) return {sources,latestSource:null,ambiguous:true,reason:'MISSING_TIME'};
  const sorted=[...effective].sort((a,b)=>Date.parse(b.modifiedAt!)-Date.parse(a.modifiedAt!));
  const tied=sorted.length>1 && Date.parse(sorted[0].modifiedAt!)===Date.parse(sorted[1].modifiedAt!);
  return {sources,latestSource:tied?null:sorted[0].source,ambiguous:tied,reason:tied?'TIED_TIME':'CANDIDATE_ONLY'};
}
