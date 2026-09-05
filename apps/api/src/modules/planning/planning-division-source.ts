export type DivisionSourceRow = {
  id: string;
  orderNumber: string;
  itemNumber: string;
  remark?: string | null;
  responsibleOrgId?: string | null;
};

const DIVISION_SOURCE = /来源：(事业[一二三四]部)\//;

export function divisionFromProvenance(remark: string | null | undefined) {
  return DIVISION_SOURCE.exec(String(remark ?? ""))?.[1] ?? null;
}

function baseItemNumber(value: string) {
  return value.replace(/-\d+\/\d+$/, "");
}

export function inferDivisionAssignments(rows: DivisionSourceRow[], currentNamesById: ReadonlyMap<string, string> = new Map()) {
  const namesByItem = new Map<string, Set<string>>();
  const namesByOrder = new Map<string, Set<string>>();
  const directName = (row: DivisionSourceRow) => divisionFromProvenance(row.remark)
    ?? (row.responsibleOrgId ? currentNamesById.get(row.responsibleOrgId) ?? null : null);
  const add = (target: Map<string, Set<string>>, key: string, name: string) => {
    const names = target.get(key) ?? new Set<string>();
    names.add(name); target.set(key, names);
  };
  for (const row of rows) {
    const name = directName(row); if (!name) continue;
    add(namesByItem, `${row.orderNumber}\u0000${baseItemNumber(row.itemNumber)}`, name);
    add(namesByOrder, row.orderNumber, name);
  }

  const assignments = new Map<string, string>();
  const unresolved: Array<{ id: string; orderNumber: string; itemNumber: string; candidates: string[] }> = [];
  for (const row of rows) {
    const direct = directName(row);
    if (direct) { assignments.set(row.id, direct); continue; }
    const itemCandidates = namesByItem.get(`${row.orderNumber}\u0000${baseItemNumber(row.itemNumber)}`) ?? new Set<string>();
    const orderCandidates = namesByOrder.get(row.orderNumber) ?? new Set<string>();
    const candidates = itemCandidates.size ? itemCandidates : orderCandidates;
    if (candidates.size === 1) assignments.set(row.id, [...candidates][0]!);
    else unresolved.push({ id: row.id, orderNumber: row.orderNumber, itemNumber: row.itemNumber, candidates: [...candidates] });
  }
  return { assignments, unresolved };
}
