/** Monthly UUID is the demand anchor; base UUID remains the production batch. */
export const mpsDemandLinkResources = ['mps-order-allocations','mps-base-plans'] as const;
export const mpsDemandLinkCapability = { code: 'mps-demand-links', label: '需求首次关联确认' } as const;
export type MpsDemandLinkResource = typeof mpsDemandLinkResources[number];
export interface MpsBindDemandRequest {
  demandId: string; expectedVersion: number; expectedDemandVersion: number; idempotencyKey: string; reason: string;
}
export interface MpsDemandLinkInfo {
  schemaReady: boolean; recordId: string; recordVersion: number; demandId: string | null; demandVersion: number | null;
  canBind: boolean;
  balance?: { required: string; allocated: string; difference: string; unallocated: string; overallocated: string; provisional: boolean };
}
