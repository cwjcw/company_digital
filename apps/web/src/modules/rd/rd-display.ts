export type RdDiffPart = { text: string; changed: boolean };
export type RdDisplayPart = { text: string; changed: boolean; queryMatched: boolean };

/**
 * Character-level comparison used only for rendering the A/B review surface.
 * It mirrors the old preview's LCS diff and never changes the matching score.
 */
export function diffParts(left: unknown, right: unknown): [RdDiffPart[], RdDiffPart[]] {
  const a = [...String(left ?? "")];
  const b = [...String(right ?? "")];
  const changedA = new Array(a.length).fill(true) as boolean[];
  const changedB = new Array(b.length).fill(true) as boolean[];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    changedA[prefix] = false;
    changedB[prefix] = false;
    prefix += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
    changedA[--endA] = false;
    changedB[--endB] = false;
  }
  const n = endA - prefix;
  const m = endB - prefix;
  if (n * m <= 250_000) {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[i]![j] = a[prefix + i] === b[prefix + j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[prefix + i] === b[prefix + j]) {
        changedA[prefix + i] = false;
        changedB[prefix + j] = false;
        i += 1;
        j += 1;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }
  const parts = (chars: string[], flags: boolean[]) => chars.reduce<RdDiffPart[]>((result, char, index) => {
    const previous = result[result.length - 1];
    const changed = flags[index] ?? true;
    if (previous && previous.changed === changed) previous.text += char;
    else result.push({ text: char, changed });
    return result;
  }, []);
  return [parts(a, changedA), parts(b, changedB)];
}

function queryMatchFlags(value: string, query: string) {
  const chars = [...value];
  const needle = [...query.trim().toLocaleLowerCase()];
  const lowered = chars.map((char) => char.toLocaleLowerCase());
  const flags = new Array(chars.length).fill(false) as boolean[];
  if (!needle.length) return flags;
  for (let start = 0; start <= lowered.length - needle.length; start += 1) {
    if (needle.every((char, offset) => lowered[start + offset] === char)) {
      for (let offset = 0; offset < needle.length; offset += 1) flags[start + offset] = true;
    }
  }
  return flags;
}

/** Merges the independent A/B diff and literal query-hit semantics for rendering. */
export function displayParts(value: unknown, other: unknown, query?: unknown): RdDisplayPart[] {
  const text = String(value ?? "");
  const [diff] = diffParts(value, other);
  const diffFlags = diff.flatMap((part) => [...part.text].map(() => part.changed));
  const queryFlags = queryMatchFlags(text, String(query ?? ""));
  return [...text].reduce<RdDisplayPart[]>((result, char, index) => {
    const changed = diffFlags[index] ?? true;
    const queryMatched = queryFlags[index] ?? false;
    const previous = result[result.length - 1];
    if (previous && previous.changed === changed && previous.queryMatched === queryMatched) previous.text += char;
    else result.push({ text: char, changed, queryMatched });
    return result;
  }, []);
}

export const rdKindLabels: Record<string, string> = {
  all: "全部",
  similar: "高相似",
  exact: "名称规格一致",
  missing: "同名缺规格",
  code: "同品号多记录",
};

export function rdKindLabel(kind: string) {
  return rdKindLabels[kind] ?? "其他结果";
}
