import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { guid, rdStatuses, timestamp, type Bom, type ComponentStatus, type ProgressItem, type Routing, type SourceBundle } from './pmc-rd-progress.types';

type Evaluation = { status: ComponentStatus; code: string; text: string; id: string | null; count: number; source: string | null };
const evaluation = (status: ComponentStatus, code: string, text: string, id: string | null = null, count = 0, source: string | null = null): Evaluation => ({status,code,text,id,count,source});
const maxTime = (values: Array<string | null>) => values.filter((v): v is string => v !== null).map(v => timestamp(v)!).sort().at(-1) ?? null;
const changes = (heads: Array<Bom | Routing>) => maxTime(heads.flatMap(h => [h.created_at,h.last_modified_at,...h.details.flatMap(d => [d.created_at,d.last_modified_at])]));
function group<T>(rows: T[], key: (row: T) => string | null) { const result = new Map<string,T[]>(); for (const row of rows) { const id = key(row); if (id) result.set(id,[...(result.get(id) ?? []),row]); } return result; }

@Injectable()
export class PmcRdProgressCalculator {
  design(candidates: Bom[], asOf: string): Evaluation {
    const active = candidates.map(bom => ({bom, details: bom.details.filter(d => d.approve_status === 'Y' && d.effective_date !== null && timestamp(d.effective_date)! <= timestamp(asOf)! && (!d.expiry_date || timestamp(d.expiry_date)! >= timestamp(asOf)!))})).filter(c => c.bom.approve_status === 'Y' && c.details.length);
    if (!candidates.length) return evaluation('NOT_STARTED','NO_BOM','未建立设计 BOM');
    if (active.length > 1) return evaluation('ABNORMAL','MULTIPLE_ACTIVE_BOMS','发现多个同时有效且已审核的 BOM，无法确定当前使用版本');
    if (active.length === 1) return evaluation('COMPLETE','DESIGN_BOM_COMPLETE','设计 BOM 已审核且存在当前有效明细',active[0]!.bom.bom_id,active[0]!.details.length);
    const approved = candidates.filter(b => b.approve_status === 'Y');
    if (!approved.length) return evaluation('IN_PROGRESS','BOM_NOT_APPROVED','存在 BOM，但尚未审核',candidates.length === 1 ? candidates[0]!.bom_id : null);
    const hasDetail = approved.some(b => b.details.some(d => d.approve_status === 'Y'));
    return evaluation('IN_PROGRESS',hasDetail ? 'NO_EFFECTIVE_BOM_DETAIL' : 'BOM_NO_APPROVED_DETAILS',hasDetail ? 'BOM 已审核，但没有当前有效的已审核 BOM 明细' : 'BOM 已审核，但没有已审核 BOM 明细',approved.length === 1 ? approved[0]!.bom_id : null);
  }
  private routeCandidate(route: Routing, source: string): Evaluation {
    const approved = route.details.filter(d => d.approve_status === 'Y'); const invalid = approved.filter(d => !guid(d.operation_id) || !d.operation_exists);
    if (route.approve_status !== 'Y') return evaluation('IN_PROGRESS','ROUTING_NOT_APPROVED','工艺路线尚未审核',route.routing_id,0,source);
    if (!approved.length) return evaluation('IN_PROGRESS','ROUTING_NO_APPROVED_OPERATIONS','工艺路线已审核，但没有已审核工序',route.routing_id,0,source);
    if (invalid.length) return evaluation('IN_PROGRESS','INVALID_OPERATION_REFERENCE','工艺路线包含无法匹配工序主档的已审核工序',route.routing_id,approved.length-invalid.length,source);
    return evaluation('COMPLETE','ROUTING_COMPLETE','工艺路线已审核且工序引用有效',route.routing_id,approved.length,source);
  }
  routing(control: string | null, standard: string | null, candidates: Routing[], byId: Map<string,Routing>): Evaluation {
    if (control === '0') return evaluation('NOT_APPLICABLE','ROUTING_NOT_APPLICABLE','该品项未启用工艺路线控制');
    if (control === '2') return evaluation('ABNORMAL','UNSUPPORTED_FEATURE_ROUTING','特征码路线控制当前缺少已验证生产样本');
    if (control !== '1') return evaluation('ABNORMAL','UNSUPPORTED_ROUTING_CONTROL',`无法识别工艺路线控制值：${control || '空'}`);
    if (standard) { const route = byId.get(standard); return route ? this.routeCandidate(route,'STANDARD_ROUTING_REFERENCE') : evaluation('ABNORMAL','STANDARD_ROUTING_NOT_FOUND','STANDARD_ROUTING_ID 指向的工艺路线不存在',null,0,'STANDARD_ROUTING_REFERENCE'); }
    if (!candidates.length) return evaluation('NOT_STARTED','NO_ROUTING','尚未建立有效工艺路线',null,0,'ITEM_PLANT_MATCH');
    const approved = candidates.filter(r => r.approve_status === 'Y');
    if (approved.length > 1) return evaluation('ABNORMAL','MULTIPLE_ACTIVE_ROUTINGS','发现多条已审核工艺路线且没有标准路线引用，无法安全选择',null,0,'ITEM_PLANT_MATCH');
    if (approved.length === 1) return this.routeCandidate(approved[0]!,'ITEM_PLANT_MATCH');
    return evaluation('IN_PROGRESS','ROUTING_NOT_APPROVED','存在工艺路线，但尚未审核',candidates.length === 1 ? candidates[0]!.routing_id : null,0,'ITEM_PLANT_MATCH');
  }
  calculate(bundle: Pick<SourceBundle,'orders'|'plants'|'boms'|'routings'|'sourceSnapshotAt'>): ProgressItem[] {
    const plants = group(bundle.plants,p => guid(p.item_id)), boms = group(bundle.boms,b => b.item_id), routes = group(bundle.routings,r => r.item_id), byId = new Map(bundle.routings.map(r => [r.routing_id,r]));
    return bundle.orders.map(row => {
      const itemId = guid(row.item_id), feature = guid(row.item_feature_id), itemPlants = plants.get(itemId ?? '') ?? []; const plant = itemPlants.length === 1 ? itemPlants[0]! : null;
      const property = plant ? String(plant.item_property ?? '').trim() : null, control = plant ? String(plant.item_routing_control ?? '').trim() : null, standard = guid(plant?.standard_routing_id), plantId = guid(plant?.owner_org_id);
      let scopedBoms: Bom[] = [], scopedRoutes: Routing[] = [], design: Evaluation, routing: Evaluation, rdStatus: ProgressItem['rdStatus'];
      if (row.item_code == null || !itemPlants.length || itemPlants.length > 1) {
        const code = row.item_code == null ? 'MISSING_ITEM' : !itemPlants.length ? 'MISSING_ITEM_PLANT' : 'MULTIPLE_ITEM_PLANT_ROWS';
        const text = row.item_code == null ? '订单品项引用的 ITEM 不存在' : !itemPlants.length ? '未找到品项对应的 ITEM_PLANT' : '同一品项存在多条 ITEM_PLANT，无法确定适用工厂';
        design = routing = evaluation('ABNORMAL',code,text); rdStatus = 'ABNORMAL';
      } else {
        scopedBoms = (boms.get(itemId ?? '') ?? []).filter(b => guid(b.owner_org_id) === plantId);
        scopedRoutes = standard ? (byId.has(standard) ? [byId.get(standard)!] : []) : (routes.get(itemId ?? '') ?? []).filter(r => guid(r.owner_org_id) === plantId && guid(r.item_feature_id) === feature);
        if (property === 'P' && control === '0') { design = evaluation('NOT_APPLICABLE','NOT_APPLICABLE','采购件不需要设计 BOM'); routing = evaluation('NOT_APPLICABLE','NOT_APPLICABLE','采购件未启用工艺路线'); rdStatus = 'NOT_APPLICABLE'; }
        else if (property !== 'M' || !['1','2'].includes(control ?? '')) { design = routing = evaluation('ABNORMAL','UNSUPPORTED_ITEM_RULE_COMBINATION',`物料属性与工艺路线控制组合尚未经过业务验证：ITEM_PROPERTY=${property || '空'}, ITEM_ROUTING_CONTROL=${control || '空'}`); rdStatus = 'ABNORMAL'; }
        else {
          design = this.design(scopedBoms,bundle.sourceSnapshotAt); routing = this.routing(control,standard,scopedRoutes,byId);
          if (design.status === 'ABNORMAL' || routing.status === 'ABNORMAL') rdStatus = 'ABNORMAL';
          else if (design.status === 'NOT_STARTED') rdStatus = 'NOT_STARTED';
          else if (design.status === 'IN_PROGRESS') rdStatus = 'DESIGN_IN_PROGRESS';
          else if (routing.status === 'NOT_STARTED') rdStatus = 'WAITING_ROUTING';
          else if (routing.status === 'IN_PROGRESS') rdStatus = 'ROUTING_IN_PROGRESS';
          else rdStatus = 'COMPLETE';
        }
      }
      const reason = rdStatus === 'ABNORMAL' ? (design.status === 'ABNORMAL' ? design : routing) : ['NOT_STARTED','DESIGN_IN_PROGRESS'].includes(rdStatus) ? design : routing;
      const bom = scopedBoms.find(b => b.bom_id === design.id), route = byId.get(routing.id ?? '');
      const bomModified = changes(scopedBoms), routeModified = changes(scopedRoutes);
      return {
        sourceOrderId: guid(row.order_id)!, sourceOrderLineId: guid(row.order_line_id)!, orderNo: row.order_no, lineNumber: row.line_number,
        customerId: guid(row.customer_id), customerCode: row.customer_code, customerName: row.customer_name,
        orderDate: row.order_date ? String(row.order_date).slice(0,10) : null, orderCreateDate: timestamp(row.order_created_at), orderLastModifiedDate: timestamp(row.order_last_modified_at),
        ownerDeptId: guid(row.owner_dept_id), ownerDeptName: row.owner_dept_name ?? null, orderStatusRaw: row.order_status_raw ?? null,
        itemId, itemCode: row.item_code, itemName: row.item_name, itemSpec: row.item_specification, itemFeatureId: feature, businessQty: String(row.quantity ?? '0'),
        itemProperty: property, routingControl: control, standardRoutingId: standard, plantOrgId: plantId,
        designBomStatus: design.status, bomId: bom?.bom_id ?? null, bomVersion: bom?.version_times ?? null, bomECode: bom?.e_code ?? null, bomApproveStatus: bom?.approve_status ?? null, validBomDetailCount: design.count,
        routingStatus: routing.status, routingId: route?.routing_id ?? null, routingCode: route?.routing_code ?? null, routingApproveStatus: route?.approve_status ?? null, validOperationCount: routing.count, routingSource: routing.source,
        rdStatus, reasonCode: rdStatus === 'COMPLETE' ? 'RD_COMPLETE' : rdStatus === 'NOT_APPLICABLE' ? 'PURCHASE_ITEM_WITHOUT_ROUTING' : reason.code,
        reasonText: rdStatus === 'COMPLETE' ? '设计 BOM 和所需工艺路线均已完成' : rdStatus === 'NOT_APPLICABLE' ? '采购件且未启用工艺路线，研发不适用' : reason.text,
        rdLastModifiedAt: maxTime([bomModified,routeModified]), sourceOrderModifiedAt: timestamp(row.order_last_modified_at), sourceBomModifiedAt: bomModified, sourceRoutingModifiedAt: routeModified
      } as ProgressItem;
    });
  }
}
export function completionRate(complete: number, applicable: number): string | null { return applicable ? new Decimal(complete).div(applicable).mul(100).toFixed(2) : null; }
export function summarize(items: Array<{rdStatus: string; designBomStatus?: string; routingStatus?: string; routingControl?: string | null}>) {
  const statusCounts = Object.fromEntries(rdStatuses.map(s => [s,items.filter(i => i.rdStatus === s).length]));
  const applicableItemCount = items.length-statusCounts.NOT_APPLICABLE!, completeItemCount = statusCounts.COMPLETE!, abnormalItemCount = statusCounts.ABNORMAL!;
  const designApplicableCount = items.filter(i => i.rdStatus !== 'NOT_APPLICABLE' && i.designBomStatus !== 'NOT_APPLICABLE').length;
  const routingApplicableCount = items.filter(i => i.rdStatus !== 'NOT_APPLICABLE' && i.routingControl !== '0' && i.routingStatus !== 'NOT_APPLICABLE').length;
  const designBomCompleteCount = items.filter(i => i.rdStatus !== 'NOT_APPLICABLE' && i.designBomStatus === 'COMPLETE').length, routingCompleteCount = items.filter(i => i.rdStatus !== 'NOT_APPLICABLE' && i.routingControl !== '0' && i.routingStatus === 'COMPLETE').length;
  return { totalItemCount: items.length, itemCount: items.length, applicableItemCount, notApplicableItemCount: statusCounts.NOT_APPLICABLE!, completeItemCount, incompleteItemCount: applicableItemCount-completeItemCount, abnormalItemCount, designBomCompleteCount, routingCompleteCount, designApplicableCount, routingApplicableCount,
    designBomCompletionRate: completionRate(designBomCompleteCount,designApplicableCount), routingCompletionRate: completionRate(routingCompleteCount,routingApplicableCount), overallCompletionRate: completionRate(completeItemCount,applicableItemCount), completionRate: completionRate(completeItemCount,applicableItemCount), statusCounts,
    orderRdStatus: items.length && !applicableItemCount ? 'NOT_APPLICABLE' : abnormalItemCount ? 'ABNORMAL' : applicableItemCount && completeItemCount === applicableItemCount ? 'COMPLETE' : 'IN_PROGRESS' };
}
