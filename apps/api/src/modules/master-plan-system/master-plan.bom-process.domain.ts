import { standardProcesses } from '@tracker/shared';
import type { BomProcessFacts, BomProcessBinding } from '@kdos/contracts';
export interface ExternalProcessMapping {
  created_by?: string; id: string; version: number; source_process_code: string; mapping_mode: string; process_code: string | null; enabled: boolean;
}
export function bindBomProcesses(facts: BomProcessFacts, mappings: ExternalProcessMapping[]): { bindings: BomProcessBinding[]; processCodes: string[] } {
  const source = new Map<string, { name: string; children: Set<string> }>();
  for (const child of facts.children) for (const p of child.processes) {
    const entry = source.get(p.code) ?? { name: p.name, children: new Set<string>() };
    entry.children.add(child.itemCode); source.set(p.code, entry);
  }
  const canonical = new Map(standardProcesses.map(p => [p.code as string, p.name]));
  const bindings: BomProcessBinding[] = [...source.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([code, entry]) => {
    const m = mappings.find(r => r.source_process_code === code);
    const matched = m?.enabled === true && m.mapping_mode === 'MATCH' && canonical.has(m.process_code ?? '');
    const ignored = m?.enabled === true && m.mapping_mode === 'IGNORE';
    return { sourceCode: code, sourceName: entry.name, childCodes: [...entry.children].sort(),
      ...(m ? { id: m.id, version: m.version, mappingMode: m.mapping_mode as 'MATCH' | 'IGNORE' } : {}),
      processCode: matched ? m!.process_code : null, processName: matched ? canonical.get(m!.process_code!)! : null,
      state: matched ? 'MATCHED' : ignored ? 'IGNORED' : 'UNMAPPED' };
  });
  const codes = new Set(bindings.filter(b => b.state === 'MATCHED').map(b => b.processCode!));
  return { bindings, processCodes: [...standardProcesses].sort((a,b) => a.order-b.order).filter(p => codes.has(p.code)).map(p => p.code) };
}
