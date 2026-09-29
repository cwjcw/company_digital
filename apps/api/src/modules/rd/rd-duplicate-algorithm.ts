import { createHash } from "node:crypto";

export type MaterialCandidate = { row: number; code: string; name: string; spec: string; sourceId?: string };
export type MaterialFeatures = {
  normalized: string; specs: string[]; numbers: string[]; qualifiers: string[]; core: string; chars: Set<string>;
};
export type MatchResult = { score: number; reasons: string[]; warnings: string[] };
export type HistoryGroup = {
  id: number; kind: "exact" | "similar" | "missing" | "code"; score: number | null; reason: string; warnings: string[];
  count: number; distinctCodes: number; records: MaterialCandidate[]; membersTruncated: boolean; search: string;
};

const SPEC = /(?:t|Φ)?\d+(?:\.\d+)?(?:\*(?:Φ)?\d+(?:\.\d+)?)+/g;
const QUALIFIERS = ["双语", "单语", "中文", "英文", "单面", "双面", "红色", "蓝色"];

export function normalize(text: unknown): string {
  let value = String(text ?? "").normalize("NFKC").toLowerCase();
  value = value.replace(/\\\*/g, "*").replaceAll("φ", "Φ").replaceAll("ø", "Φ");
  value = value.replace(/(?<=\d)\s*[x×]\s*(?=\d)/g, "*");
  return value.replace(/\s+/g, "");
}

function featuresFromNormalized(normalized: string): MaterialFeatures {
  const specs = [...new Set(normalized.match(SPEC) ?? [])];
  const numbers = specs.flatMap((spec) => [...spec.matchAll(/\d+(?:\.\d+)?/g)].map((match) => String(Number(match[0]))));
  const qualifiers = QUALIFIERS.filter((qualifier) => normalized.includes(qualifier)).sort();
  let core = normalized.replace(SPEC, "");
  for (const qualifier of qualifiers) core = core.replaceAll(qualifier, "");
  core = core.replaceAll("易碎物品标识", "易碎").replaceAll("易碎品", "易碎").replaceAll("标签贴纸", "标签").replaceAll("贴纸", "标签");
  core = [...core].filter((char) => /[\p{Letter}\p{Number}\u4e00-\u9fff]/u.test(char)).join("");
  return { normalized, specs, numbers, qualifiers, core, chars: new Set([...core]) };
}

export function features(row: { name?: unknown; spec?: unknown }): MaterialFeatures {
  return featuresFromNormalized(normalize(`${row.name ?? ""} ${row.spec ?? ""}`));
}

function sequenceRatio(a: string, b: string): number {
  if (!a && !b) return 1;
  const previous = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(previous[j], previous[j - 1]);
      diagonal = above;
    }
  }
  return (2 * previous[b.length]) / (a.length + b.length || 1);
}

export function compare(a: MaterialFeatures, b: MaterialFeatures): MatchResult | null {
  if (!a.chars.size || !b.chars.size) return null;
  let intersection = 0;
  for (const char of a.chars) if (b.chars.has(char)) intersection++;
  const overlap = intersection / (a.chars.size + b.chars.size - intersection);
  if (overlap < 0.38) return null;
  let score = 60 * overlap + 10 * sequenceRatio(a.core, b.core);
  const reasons = ["主体文字接近（按无序字符和限定词规则比较）"];
  const warnings: string[] = [];
  if (a.specs.length && b.specs.length) {
    if (JSON.stringify(a.specs) === JSON.stringify(b.specs)) { score += 30; reasons.push("规格表达一致，保留数字顺序"); }
    else if (JSON.stringify(a.numbers) !== JSON.stringify(b.numbers)) { score = Math.min(score, 45); warnings.push("规格数字或顺序不同，不能直接当作同物"); }
    else { score = Math.min(score + 15, 75); warnings.push("规格标记不同，请核对含义和单位"); }
  } else { warnings.push("至少一条缺少可解析的规格，证据不足"); score = Math.min(score, 70); }
  const aq = new Set(a.qualifiers), bq = new Set(b.qualifiers);
  const conflict = [["双语", "单语"], ["单面", "双面"], ["红色", "蓝色"]].some(([x, y]) => (aq.has(x) && bq.has(y)) || (aq.has(y) && bq.has(x)));
  if (JSON.stringify([...aq]) !== JSON.stringify([...bq])) { warnings.push(`限定描述不同或缺失：${[...new Set([...aq, ...bq])].filter((v) => !aq.has(v) || !bq.has(v)).sort().join(" / ")}；未注明不等于相同`); score = Math.min(score, 88); }
  if (conflict) { warnings.push("存在明确限定属性冲突，需人工核对"); score = Math.min(score, 40); }
  if (a.specs.length > 1 || b.specs.length > 1) { warnings.push("存在多组规格，请检查名称与规格列是否矛盾"); score = Math.min(score, 60); }
  return score < 35 ? null : { score: Number(score.toFixed(1)), reasons, warnings };
}

export type PreparedMaterialCandidate = MaterialCandidate & { nameKey: string; specKey: string; matchText: string; category: string; f: MaterialFeatures; attrs: Record<string, Set<string>>; numbers: string[] };
export type PersistedMaterialFeatures = {
  featureHash: string;
  normalizedName: string;
  normalizedSpec: string;
  inferredCategory: string;
  numericFeatures: string[];
  qualifiers: string[];
  attributes: Record<string, string[]>;
  candidateKeys: string[];
  featureJson: {
    nameKey: string;
    specKey: string;
    matchText: string;
    category: string;
    f: { normalized: string; specs: string[]; numbers: string[]; qualifiers: string[]; core: string; chars: string[] };
    attrs: Record<string, string[]>;
    numbers: string[];
  };
};
const categories = ["螺钉", "螺栓", "螺母", "垫圈", "螺杆", "贴纸", "标签", "纸箱", "圆管", "钢板"];
const attributes: Record<string, string[]> = {
  材质: ["201", "304", "316", "430", "q195", "q215", "q235", "6061", "6063", "碳钢", "尼龙"],
  扳拧方式: ["内六角", "外六角", "一字槽", "十字槽"], 头型: ["圆柱头", "盘头", "半沉头", "沉头", "平端", "锥端"],
  表面处理: ["镀彩锌", "镀黑锌", "镀锌", "镀铬", "镀镍", "发黑", "磷化", "双面拉丝", "单面拉丝"], 语言: ["单语", "双语"]
};
function canonical(value: unknown) { return normalize(value).replace(/(?<=\d)[x×](?=[Φ\d])/g, "*"); }
export function prepareMaterial(row: MaterialCandidate): PreparedMaterialCandidate {
  const nameKey = canonical(row.name), sourceSpecKey = canonical(row.spec), specKey = ["", "-", "—", "/", "无", "未注明"].includes(sourceSpecKey) ? "" : sourceSpecKey;
  const f = featuresFromNormalized(canonical(`${nameKey} ${specKey}`)); const text = canonical(`${nameKey}${sourceSpecKey}`);
  const attrs: Record<string, Set<string>> = {};
  for (const [key, terms] of Object.entries(attributes)) attrs[key] = new Set(terms.filter((term) => text.includes(term)));
  return { ...row, nameKey, specKey, matchText: text, category: categories.find((word) => nameKey.includes(word)) ?? "未确定", f, attrs, numbers: [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]) };
}

function candidateKeys(row: PreparedMaterialCandidate) {
  const key = row.f.specs.length ? JSON.stringify(row.f.specs) : row.specKey ? `raw:${row.specKey}` : "";
  return key ? [key] : [];
}

export function materialFeatureHash(row: MaterialCandidate) {
  return stableHash({ name: String(row.name ?? ""), spec: String(row.spec ?? "") });
}

export function serializeMaterialFeatures(row: PreparedMaterialCandidate): PersistedMaterialFeatures {
  const attributes: Record<string, string[]> = Object.fromEntries(Object.entries(row.attrs).map(([key, values]) => [key, [...values]]));
  return {
    featureHash: materialFeatureHash(row), normalizedName: row.nameKey, normalizedSpec: row.specKey,
    inferredCategory: row.category, numericFeatures: row.numbers, qualifiers: row.f.qualifiers,
    attributes, candidateKeys: candidateKeys(row),
    featureJson: {
      nameKey: row.nameKey, specKey: row.specKey, matchText: row.matchText, category: row.category,
      f: { ...row.f, chars: [...row.f.chars] }, attrs: attributes, numbers: row.numbers,
    },
  };
}

export function prepareMaterialFromFeatures(row: MaterialCandidate, persisted: PersistedMaterialFeatures): PreparedMaterialCandidate {
  const feature = persisted.featureJson;
  return {
    ...row, nameKey: feature.nameKey, specKey: feature.specKey, matchText: feature.matchText, category: feature.category,
    f: { ...feature.f, chars: new Set(feature.f.chars) }, attrs: Object.fromEntries(Object.entries(feature.attrs).map(([key, values]) => [key, new Set(values)])), numbers: feature.numbers,
  };
}
const commonWarning = "类别仅根据品名提示；自制件须核对图纸、孔位和版本，不自动判重。";

type RankedCandidate = MaterialCandidate & { score: number; reason: string; warnings: string[] };
function candidatePool(target: PreparedMaterialCandidate, source: PreparedMaterialCandidate[]) {
  // This is an index of the complete prepared library, not a data-source
  // truncation: category filtering is the same existing rule used below.
  return target.category === "未确定" ? source : source.filter((item) => item.category === target.category || item.category === "未确定");
}
function rankOne(target: PreparedMaterialCandidate, candidate: PreparedMaterialCandidate): RankedCandidate | null {
  if (!candidate.nameKey && !candidate.specKey) return null;
  if (target.category !== candidate.category && ![target.category, candidate.category].includes("未确定")) return null;
  if (Object.keys(target.attrs).some((key) => target.attrs[key].size && candidate.attrs[key].size && JSON.stringify([...target.attrs[key]]) !== JSON.stringify([...candidate.attrs[key]]))) return null;
  const match = compare(target.f, candidate.f); const lexical = sequenceRatio(target.matchText, candidate.matchText) * 100;
  let score = Math.max(match?.score ?? 0, lexical);
  if (target.nameKey === candidate.nameKey && target.specKey === candidate.specKey) score = 100;
  else if (!target.nameKey || !target.specKey) score = Math.min(score, 85);
  if (score < 20) return null;
  return { row: candidate.row, code: candidate.code, name: candidate.name, spec: candidate.spec, score: Number(score.toFixed(1)), reason: match?.reasons.join("；") ?? "名称或规格存在相似表达。", warnings: match?.warnings ?? [] };
}
function sortRanked(ranked: RankedCandidate[], limit: number) {
  return ranked.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}
export function rankPrepared(name: string, spec: string, source: PreparedMaterialCandidate[], limit = 5) {
  const target = prepareMaterial({ row: 0, code: "", name, spec }); const ranked: RankedCandidate[] = [];
  for (const candidate of candidatePool(target, source)) { const result = rankOne(target, candidate); if (result) ranked.push(result); }
  return sortRanked(ranked, limit);
}
export async function rankPreparedCancellable(name: string, spec: string, source: PreparedMaterialCandidate[], limit = 5, signal?: AbortSignal) {
  const target = prepareMaterial({ row: 0, code: "", name, spec }); const ranked: RankedCandidate[] = [];
  const candidates = candidatePool(target, source);
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) return [];
    const result = rankOne(target, candidates[index]); if (result) ranked.push(result);
    if ((index & 2047) === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return sortRanked(ranked, limit);
}

export function rankRecent(name: string, spec: string, source: MaterialCandidate[], limit = 5) {
  return rankPrepared(name, spec, source.map(prepareMaterial), limit);
}

function finishGroups(rows: PreparedMaterialCandidate[], groups: HistoryGroup[], comparedPairs: number, skippedBlocks: number, skippedPairs: number) {
  const order: Record<HistoryGroup["kind"], number> = { exact: 0, similar: 1, missing: 2, code: 3 };
  groups.sort((a, b) => order[a.kind] - order[b.kind] || (b.score ?? 0) - (a.score ?? 0) || b.count - a.count || a.id - b.id);
  return { rows: rows.length, groups, counts: Object.fromEntries(Object.keys(order).map((kind) => [kind, groups.filter((group) => group.kind === kind).length])), comparedPairs, skippedBlocks, skippedPairs, generatedAt: new Date().toISOString().slice(0, 19), ruleVersion: "history-1", coverage: "名称规格一致、同名缺规格、同品号分组覆盖全部记录；模糊比较只在相同规格候选桶内进行，超过120条的桶跳过模糊比较。结果不是全部重复物料清单。" };
}

export function scanPreparedRows(rows: PreparedMaterialCandidate[], onProgress: (progress: Record<string, unknown>) => void = () => undefined) {
  const groups: HistoryGroup[] = []; const exact = new Map<string, number[]>(), missing = new Map<string, number[]>(), codes = new Map<string, number[]>(), blocks = new Map<string, number[]>();
  const addTo = (map: Map<string, number[]>, key: string, i: number) => { const indexes = map.get(key); if (indexes) indexes.push(i); else map.set(key, [i]); };
  rows.forEach((row, i) => { addTo(codes, row.code, i); if (row.nameKey) addTo(row.specKey ? exact : missing, row.specKey ? `${row.nameKey}\0${row.specKey}` : row.nameKey, i); for (const key of candidateKeys(row)) addTo(blocks, key, i); });
  const add = (kind: HistoryGroup["kind"], indexes: number[], score: number | null, reason: string, warnings: string[]) => { const records = indexes.map((i) => rows[i]); groups.push({ id: groups.length + 1, kind, score, reason, warnings, count: records.length, distinctCodes: new Set(records.map((r) => r.code)).size, records: records.slice(0, 50).map(({ row, code, name, spec, sourceId }) => ({ row, code, name, spec, sourceId })), membersTruncated: records.length > 50, search: records.map((r) => `${r.code} ${r.name} ${r.spec}`).join("\n") }); };
  for (const indexes of exact.values()) if (new Set(indexes.map((i) => rows[i].code)).size > 1) add("exact", indexes, 95, "不同品号的品名与非空规格，经空格、全半角、乘号标准化后均一致。", [commonWarning]);
  for (const indexes of missing.values()) if (new Set(indexes.map((i) => rows[i].code)).size > 1) add("missing", indexes, null, "品名标准化后一致，但规格列缺失或为占位符。", ["信息不足，不能仅凭同名确认同物。", commonWarning]);
  for (const indexes of codes.values()) if (indexes[0] !== undefined && rows[indexes[0]].code && indexes.length > 1) add("code", indexes, null, "同一品号有多条来源记录，请检查导出重复、版本或字段冲突。", [commonWarning]);
  onProgress({ stage: "相似候选比较", processedItems: rows.length, totalItems: rows.length, exactGroups: groups.length }); let comparedPairs = 0, skippedBlocks = 0, skippedPairs = 0;
  for (const indexes of blocks.values()) {
    if (indexes.length > 120) { skippedBlocks++; skippedPairs += indexes.length * (indexes.length - 1) / 2; continue; }
    for (let x = 0; x < indexes.length; x++) for (let y = x + 1; y < indexes.length; y++) {
      const a = rows[indexes[x]], b = rows[indexes[y]]; if (a.code === b.code || (a.nameKey === b.nameKey && a.specKey === b.specKey)) continue; comparedPairs++;
      if (a.category !== b.category && ![a.category, b.category].includes("未确定")) continue;
      if (Object.keys(a.attrs).some((key) => a.attrs[key].size && b.attrs[key].size && JSON.stringify([...a.attrs[key]]) !== JSON.stringify([...b.attrs[key]]))) continue;
      if (JSON.stringify([...a.numbers].sort()) !== JSON.stringify([...b.numbers].sort())) continue;
      const match = compare(a.f, b.f); if (!match || match.score < 80) continue;
      const warnings = [...match.warnings, commonWarning]; if (Object.keys(a.attrs).some((key) => Boolean(a.attrs[key].size) !== Boolean(b.attrs[key].size))) warnings.unshift("部分材质/处理/头型等属性只在一条记录中注明，须补充核实。");
      add("similar", [indexes[x], indexes[y]], Math.min(match.score, 90), "规格表达相同，名称存在词序、重复词或标签别名差异。", warnings);
    }
  }
  onProgress({ stage: "完成", processedItems: rows.length, totalItems: rows.length, processedBlocks: blocks.size, totalBlocks: blocks.size });
  return finishGroups(rows, groups, comparedPairs, skippedBlocks, skippedPairs);
}

export function scanChangedPreparedRows(rows: PreparedMaterialCandidate[], changedIds: Set<string>, onProgress: (progress: Record<string, unknown>) => void = () => undefined) {
  const changedIndexes = new Set(rows.flatMap((row, index) => row.sourceId && changedIds.has(row.sourceId) ? [index] : []));
  const groups: HistoryGroup[] = []; const exact = new Map<string, number[]>(), missing = new Map<string, number[]>(), codes = new Map<string, number[]>(), blocks = new Map<string, number[]>();
  const addTo = (map: Map<string, number[]>, key: string, i: number) => { const indexes = map.get(key); if (indexes) indexes.push(i); else map.set(key, [i]); };
  rows.forEach((row, i) => { addTo(codes, row.code, i); if (row.nameKey) addTo(row.specKey ? exact : missing, row.specKey ? `${row.nameKey}\0${row.specKey}` : row.nameKey, i); for (const key of candidateKeys(row)) addTo(blocks, key, i); });
  const add = (kind: HistoryGroup["kind"], indexes: number[], score: number | null, reason: string, warnings: string[]) => { const records = indexes.map((i) => rows[i]); groups.push({ id: groups.length + 1, kind, score, reason, warnings, count: records.length, distinctCodes: new Set(records.map((r) => r.code)).size, records: records.slice(0, 50).map(({ row, code, name, spec, sourceId }) => ({ row, code, name, spec, sourceId })), membersTruncated: records.length > 50, search: records.map((r) => `${r.code} ${r.name} ${r.spec}`).join("\n") }); };
  const touchesChanged = (indexes: number[]) => indexes.some((index) => changedIndexes.has(index));
  for (const indexes of exact.values()) if (touchesChanged(indexes) && new Set(indexes.map((i) => rows[i].code)).size > 1) add("exact", indexes, 95, "不同品号的品名与非空规格，经空格、全半角、乘号标准化后均一致。", [commonWarning]);
  for (const indexes of missing.values()) if (touchesChanged(indexes) && new Set(indexes.map((i) => rows[i].code)).size > 1) add("missing", indexes, null, "品名标准化后一致，但规格列缺失或为占位符。", ["信息不足，不能仅凭同名确认同物。", commonWarning]);
  for (const indexes of codes.values()) if (touchesChanged(indexes) && indexes[0] !== undefined && rows[indexes[0]].code && indexes.length > 1) add("code", indexes, null, "同一品号有多条来源记录，请检查导出重复、版本或字段冲突。", [commonWarning]);
  onProgress({ stage: "相似候选比较", processedItems: changedIndexes.size, totalItems: rows.length }); let comparedPairs = 0, skippedBlocks = 0, skippedPairs = 0;
  for (const indexes of blocks.values()) {
    if (indexes.length > 120) { skippedBlocks++; skippedPairs += indexes.length * (indexes.length - 1) / 2; continue; }
    for (let x = 0; x < indexes.length; x++) for (let y = x + 1; y < indexes.length; y++) {
      const a = rows[indexes[x]], b = rows[indexes[y]]; if (a.code === b.code || (a.nameKey === b.nameKey && a.specKey === b.specKey)) continue; comparedPairs++;
      if (!changedIndexes.has(indexes[x]) && !changedIndexes.has(indexes[y])) continue;
      if (a.category !== b.category && ![a.category, b.category].includes("未确定")) continue;
      if (Object.keys(a.attrs).some((key) => a.attrs[key].size && b.attrs[key].size && JSON.stringify([...a.attrs[key]]) !== JSON.stringify([...b.attrs[key]]))) continue;
      if (JSON.stringify([...a.numbers].sort()) !== JSON.stringify([...b.numbers].sort())) continue;
      const match = compare(a.f, b.f); if (!match || match.score < 80) continue;
      const warnings = [...match.warnings, commonWarning]; if (Object.keys(a.attrs).some((key) => Boolean(a.attrs[key].size) !== Boolean(b.attrs[key].size))) warnings.unshift("部分材质/处理/头型等属性只在一条记录中注明，须补充核实。");
      add("similar", [indexes[x], indexes[y]], Math.min(match.score, 90), "规格表达相同，名称存在词序、重复词或标签别名差异。", warnings);
    }
  }
  onProgress({ stage: "完成", processedItems: changedIndexes.size, totalItems: rows.length, processedBlocks: blocks.size, totalBlocks: blocks.size });
  return finishGroups(rows, groups, comparedPairs, skippedBlocks, skippedPairs);
}

export function scanRows(source: MaterialCandidate[], onProgress: (progress: Record<string, unknown>) => void = () => undefined) {
  return scanPreparedRows(source.map(prepareMaterial), onProgress);
}

export function stableHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export function diffParts(left: unknown, right: unknown): Array<Array<{ text: string; changed: boolean }>> {
  const a = [...String(left ?? "")], b = [...String(right ?? "")]; const ca = new Array(a.length).fill(true), cb = new Array(b.length).fill(true); let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) { ca[prefix] = false; cb[prefix] = false; prefix++; }
  let endA = a.length, endB = b.length; while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) { ca[--endA] = false; cb[--endB] = false; }
  const n = endA - prefix, m = endB - prefix;
  if (n * m <= 250000) { const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[prefix + i] === b[prefix + j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]); let i = 0, j = 0; while (i < n && j < m) { if (a[prefix + i] === b[prefix + j]) { ca[prefix + i++] = false; cb[prefix + j++] = false; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; } }
  const parts = (chars: string[], flags: boolean[]) => chars.reduce<Array<{ text: string; changed: boolean }>>((out, text, i) => { const last = out[out.length - 1]; if (last && last.changed === flags[i]) last.text += text; else out.push({ text, changed: flags[i] }); return out; }, []);
  return [parts(a, ca), parts(b, cb)];
}
