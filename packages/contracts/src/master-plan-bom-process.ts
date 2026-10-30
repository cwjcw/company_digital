/** First-level BOM facts are configuration provenance, never child work-report facts. */
export const mpsExternalProcessMappingResource = 'mps-external-process-mappings' as const;
export const kejiaSourceKey = 'tplus-kejia' as const;
export interface BomSourceProcess { code: string; name: string; sequence: number; source: string }
export interface BomChildFact {
  id: string; bomId: string; bomVersion: string; itemCode: string; itemName: string;
  routeCode: string | null; routeName: string | null; source: string;
  state: 'READY' | 'NO_ROUTE' | 'AMBIGUOUS'; processes: BomSourceProcess[];
}
export interface BomProcessFacts {
  sourceKey: typeof kejiaSourceKey; sourceDatabase: string; observedAt: string;
  orderNumber: string; itemCode: string; orderLineId: string | null;
  state: 'READY' | 'NO_BOM' | 'AMBIGUOUS'; message: string;
  bomId: string | null; bomVersion: string | null; children: BomChildFact[];
  catalog: Array<{ code: string; name: string }>;
}
export interface BomProcessBinding {
  sourceCode: string; sourceName: string; childCodes: string[];
  canWrite?: boolean; id?: string; version?: number; mappingMode?: 'MATCH' | 'IGNORE';
  processCode: string | null; processName: string | null; state: 'MATCHED' | 'IGNORED' | 'UNMAPPED';
}
export interface MpsBomProcessView {
  supported: boolean; message: string; divisionId: string; divisionName: string;
  facts: BomProcessFacts | null; bindings: BomProcessBinding[];
  progress: Array<Record<string, string | number | null>>; progressFields: string[];
  unmappedCount: number; canConfigure: boolean; canExport: boolean;
}
