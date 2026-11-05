/** Lifecycle is independent of quantities, process enablement and completion. */
export const mpsPlanLifecycleStatuses = ['ACTIVE', 'ON_HOLD', 'CANCELLED', 'LEGACY_RETAINED'] as const;
export type MpsPlanLifecycleStatus = typeof mpsPlanLifecycleStatuses[number];
export const mpsPlanLifecycleOptions = [
    { value: 'ACTIVE', label: '有效计划' }, { value: 'ON_HOLD', label: '暂停执行' },
    { value: 'CANCELLED', label: '已取消' }, { value: 'LEGACY_RETAINED', label: '历史保留（来源待确认）' }
];
export const mpsLifecycleResources = ['mps-monthly-plans', 'mps-base-plans', 'mps-weekly-plans'] as const;
export const mpsLifecycleCapabilities = [
    { code: 'mps-plan-hold', label: '计划暂停' }, { code: 'mps-plan-cancel', label: '计划取消' },
    { code: 'mps-plan-restore', label: '计划恢复及来源确认' },
    { code: 'mps-plan-cancel-remaining', label: '已执行计划剩余需求取消' },
    { code: 'mps-plan-correct-facts', label: '暂停/取消计划历史报工纠错' }
] as const;
export const mpsLifecycleOperations = {
    HOLD: { label: '暂停计划', capability: 'mps-plan-hold', target: 'ON_HOLD' },
    CANCEL: { label: '取消计划', capability: 'mps-plan-cancel', target: 'CANCELLED' },
    RESTORE: { label: '恢复/确认有效', capability: 'mps-plan-restore', target: 'ACTIVE' },
    CANCEL_REMAINING: { label: '取消剩余需求', capability: 'mps-plan-cancel-remaining', target: 'CANCELLED' }
} as const;
export type MpsLifecycleOperation = keyof typeof mpsLifecycleOperations;
export interface MpsLifecyclePreview {
    resource: string;
    recordId: string;
    operation: MpsLifecycleOperation;
    currentStatus: MpsPlanLifecycleStatus;
    targetStatus: MpsPlanLifecycleStatus;
    orderNumber: string;
    itemCode: string;
    divisionId: string | null;
    divisionName: string | null;
    plannedQuantity: string;
    expectedVersion: number;
    facts: Record<string, string | number | boolean>;
    affectedPlans: Array<{
        resource: string;
        id: string;
        status: string; orderNumber: string; itemCode: string; deliveryNumber: string | null;
    }>;
    allowed: boolean;
    blockers: string[];
    requiredPermissions: string[];
    writesEnabled: boolean;
    previewToken: string;
    expiresAt: number;
}
