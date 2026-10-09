/** One RFC 9110 bytes range; reject multiple ranges and invalid/unsatisfiable operands. */
export function knowledgeByteRange(
  value: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size <= 0)
    throw new Error("Unsatisfiable range");
  const first = match[1] ? Number(match[1]) : null,
    last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  )
    throw new Error("Invalid range");
  if (first === null) {
    if (!last || last < 1) throw new Error("Invalid suffix");
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || first < 0 || (last !== null && last < first))
    throw new Error("Unsatisfiable range");
  return {
    start: first,
    end: last === null ? size - 1 : Math.min(last, size - 1),
  };
}
