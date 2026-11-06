/** inboundDate is the latest reviewed delivery date, never actual warehouse receipt. Customer dueDate is not applied. */
export const mpsReviewApplicationMapping = { source: 'inboundDate', target: 'latestReviewDueDate' } as const;
export interface MpsReviewApplyRequest {
    expectedReviewVersion: number;
    targets: Array<{
        baseId: string;
        expectedVersion: number;
    }>;
}
export interface MpsReviewApplyConfirm extends MpsReviewApplyRequest {
    previewHash: string;
    idempotencyKey: string;
    reason: string;
}
export interface MpsReviewApplicationInfo {
    reviewId: string;
    reviewVersion: number;
    orderNumber: string;
    itemCode: string;
    divisionName: string | null;
    demandId: string | null;
    batchNumber: string;
    reviewDate: string | null;
    customerDate: string | null;
    canApply: boolean;
    canBind: boolean;
    blockers: string[];
    candidates: Array<{
        id: string;
        version: number;
        deliveryNumber: string;
        quantity: string;
        customerDate: string | null;
        reviewDate: string | null;
        status: string;
        protected: boolean;
        canUpdate: boolean;
        appliedVersion: number | null;
        appliedDate: string | null;
        pending: boolean;
        otherReview: boolean;
    }>;
    history: Array<{
        id: string;
        baseId: string;
        deliveryNumber: string;
        reviewVersion: number;
        date: string;
        appliedAt: string;
        version: number;
        syncStatus: string;
    }>;
}
export interface MpsReviewApplyPreview {
    info: MpsReviewApplicationInfo;
    request: MpsReviewApplyRequest;
    allowed: boolean;
    blockers: string[];
    changes: Array<{
        baseId: string;
        deliveryNumber: string;
        before: string | null;
        after: string;
    }>;
    previewHash: string;
}
export interface MpsReviewApplyResult {
    reviewId: string;
    applicationIds: string[];
    outboxId: string | null;
    syncStatus: string;
    repeated: boolean;
}
