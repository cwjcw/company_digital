/** Exact decimal strings; an unknown balance is null, never an inferred zero. */
export const mpsQuantityOperations = ['INCREASE','NEW','REDUCE','SPLIT','MERGE'] as const;
export type MpsQuantityOperation = typeof mpsQuantityOperations[number];
export const mpsQuantityBatchFields = ['latestCustomerDueDate','latestReviewDueDate','productAttribute','surfaceNature','manufacturingMethod','modelAge'] as const;
export interface MpsQuantityRequest {
    newBatchValues?: Partial<Record<typeof mpsQuantityBatchFields[number],string>>;
    operation: MpsQuantityOperation;
    quantity: string;
    sourceId?: string;
    targetId?: string;
    expectedDemandVersion: number;
    expectedVersions: Record<string, number>;
}
export interface MpsQuantitySnapshot {
    demandId: string;
    demandVersion: number;
    orderNumber: string;
    itemCode: string;
    status: string;
    required: string | null;
    originalRequired: string;
    allocated: string;
    fulfilled: string | null;
    remainingReserved: string | null;
    heldReserved: string | null;
    cancelledFulfilled: string | null;
    difference: string | null;
    unallocated: string | null;
    overallocated: string | null;
    trusted: boolean;
    relationStatus: 'CONFIRMED' | 'PENDING';
    blockers: string[];
    canUpdate: boolean;
    canCreate: boolean;
    batches: Array<{
        id: string;
        version: number;
        deliveryNumber: string;
        quantity: string;
        status: string;
        protected: boolean;
        manual: boolean;
        canUpdate: boolean;
    }>;
}
export interface MpsQuantityPreview {
    snapshot: MpsQuantitySnapshot;
    request: MpsQuantityRequest;
    allowed: boolean;
    blockers: string[];
    afterBalance: {allocated:string;unallocated:string|null;overallocated:string|null};
    changes: Array<{
        id: string;
        before: string;
        after: string;
    }>;
    previewHash: string;
}
export interface MpsQuantityConfirm extends MpsQuantityRequest {
    previewHash: string;
    idempotencyKey: string;
    reason: string;
}
export interface MpsQuantityResult {
    demandId: string;
    batchIds: string[];
    repeated: boolean;
    syncStatus: string;
    outboxId: string;
}
