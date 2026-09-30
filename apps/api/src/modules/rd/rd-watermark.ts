export type RdCursor = { at: string; id: string };

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00(?::?00)?)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep source timestamps as text; JavaScript Date would lose E10 microseconds. */
export function normalizeRdTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) throw new Error("研发中心 watermark 禁止使用 JavaScript Date，以免丢失微秒精度");
  const match = TIMESTAMP_PATTERN.exec(String(value).trim());
  if (!match) throw new Error(`无效的研发中心 watermark 时间：${String(value)}`);
  return `${match[1]} ${match[2]}.${(match[3] ?? "").padEnd(6, "0")}`;
}

export function normalizeRdUuid(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`无效的研发中心 watermark ID：${String(value)}`);
  return normalized;
}

/** SQL Server uniqueidentifier ordering uses mixed-endian GUID bytes. */
function sqlServerUuidSortKey(value: string): string {
  const [first, second, third, fourth, fifth] = normalizeRdUuid(value).split("-");
  const reverseBytes = (part: string) => part.match(/../g)!.reverse().join("");
  return `${reverseBytes(first!)}${reverseBytes(second!)}${reverseBytes(third!)}${fourth}${fifth}`;
}

export function compareRdCursor(left: RdCursor, right: RdCursor): number {
  if (left.at < right.at) return -1;
  if (left.at > right.at) return 1;
  const leftId = sqlServerUuidSortKey(left.id);
  const rightId = sqlServerUuidSortKey(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function advanceRdCursor(current: RdCursor | null, at: unknown, id: unknown): RdCursor | null {
  const normalizedAt = normalizeRdTimestamp(at);
  if (!normalizedAt || id == null || id === "") return current;
  const candidate = { at: normalizedAt, id: normalizeRdUuid(id) };
  return !current || compareRdCursor(candidate, current) > 0 ? candidate : current;
}

export function postgresRdTimestamp(cursorAt: string | null): string | null {
  return cursorAt ? `${cursorAt}+00:00` : null;
}

export function apiRdTimestamp(cursorAt: string | null): string | null {
  return cursorAt ? `${cursorAt.replace(" ", "T")}Z` : null;
}
