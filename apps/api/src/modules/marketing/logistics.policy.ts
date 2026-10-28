import { ForbiddenException } from '@nestjs/common';
import { logisticsBusinessFields, logisticsFeeKeys, logisticsResource as resource } from '@kdos/contracts';
import { buildDataScopeClause } from '../../common/filtering/data-scope';
import type { TableFilterActor } from '../../common/filtering/table-filter.registry';
export type LogisticsActor = TableFilterActor & { requestId?: string; ip?: string };
export const logisticsColumn = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
export const logisticsColumns = Object.fromEntries([...logisticsBusinessFields.map(f => f.key), 'orderNumbers', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'].map(k => [k, logisticsColumn(k)]));
export const logisticsAdmin = (a: TableFilterActor) => a.isSystemAdmin || a.permissions.includes('*') || a.moduleAdminCodes?.includes('marketing');
export const logisticsAction = (a: TableFilterActor, action: string) => Boolean(logisticsAdmin(a) || a.permissions.includes(`${resource}:*:${action}`));
export function logisticsField(a: TableFilterActor, key: string, action = 'read'): boolean {
  if (key === 'totalFee' && action !== 'read') return false;
  if (logisticsAdmin(a)) return true;
  if (key === 'totalFee' && !logisticsFeeKeys.every(k => logisticsField(a, k))) return false;
  return a.permissions.includes(`${resource}:${key}:${action}`);
}
export function logisticsAuthorize(a: TableFilterActor) {
  if (!logisticsAction(a, 'read')) throw new ForbiddenException('没有物流台账查看权限');
  // The platform consumes explicit field grants; remove the aggregate grant if it could reveal a hidden fee.
  if (!logisticsField(a, 'totalFee')) a.permissions = a.permissions.filter(p => p !== `${resource}:totalFee:read`);
}
export function logisticsScope(a: TableFilterActor, p: unknown[], action = 'read'): string {
  const tenant = "record.tenant_id=(SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true)";
  if (logisticsAdmin(a)) return tenant;
  // Do not inherit the Planning module's administrator bypass into Marketing.
  const scope = buildDataScopeClause({ resource, action, actor: { ...a, moduleAdminCodes: [] }, columns: logisticsColumns, params: p,
    numericFields: [...logisticsFeeKeys, 'totalFee', 'quantity', 'packingQuantity', 'netWeight', 'grossWeight'] });
  let shared = '1=0';
  if (a.userId && action === 'read') {
    p.push(a.userId);
    shared = `EXISTS(SELECT 1 FROM marketing.logistics_details ld JOIN marketing.order_schedules os ON os.tenant_id=ld.tenant_id AND os.order_number=ld.order_number AND os.status='NORMAL' WHERE ld.tenant_id=record.tenant_id AND ld.shipment_id=record.shipment_id AND $${p.length}::uuid=ANY(os.salesperson_user_ids))`;
  }
  // Export scope is still intersected with read by the platform, never widened by sharing.
  const result = `(${tenant} AND ((${scope}) OR (${shared})))`;
  return action === 'export' ? `(${result} AND (${logisticsScope(a, p, 'read')}))` : result;
}
