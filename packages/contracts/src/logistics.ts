import type { TablePermissionFieldDefinition } from './index';

export const logisticsResource = 'logistics-ledger' as const;
export const logisticsFeeKeys = ['portFee', 'customsFee', 'inspectionFee', 'truckingFee', 'fumigationFee', 'exceptionFee'] as const;
export const logisticsMasterKeys = ['logisticsNumber', 'customerCode', 'ownerUserId', 'shipmentDate', 'containerType', 'containerNumber', ...logisticsFeeKeys, 'remark'] as const;
export const logisticsDetailKeys = ['sequence', 'styleNumber', 'itemName', 'material', 'quantity', 'packingQuantity', 'netWeight', 'grossWeight', 'orderNumber'] as const;
/** Exact business template: the source's seventeen columns followed by six additions. */
export const logisticsBusinessFields: TablePermissionFieldDefinition[] = [
  { key: 'sequence', label: '序号', type: 'text', editable: true },
  { key: 'styleNumber', label: '款号', type: 'text', editable: true },
  { key: 'itemName', label: '品名', type: 'text', editable: true },
  { key: 'material', label: '材质', type: 'text', editable: true },
  ...([['quantity', '数量（PCS）'], ['packingQuantity', '装箱量'], ['netWeight', '净重'], ['grossWeight', '毛重']] as const).map(([key, label]) => ({ key, label, type: 'number' as const, format: 'decimal' as const, exactNumeric: true, editable: true })),
  { key: 'containerType', label: '柜型', type: 'text', editable: true },
  { key: 'containerNumber', label: '柜号', type: 'text', editable: true },
  ...logisticsFeeKeys.map((key, i) => ({ key, label: ['港杂费', '报关费', '报检费', '拖车费', '熏蒸费', '异常费'][i]!, type: 'number' as const, format: 'currency' as const, exactNumeric: true, editable: true })),
  { key: 'remark', label: '备注', type: 'text', editable: true },
  { key: 'logisticsNumber', label: '物流单号', type: 'text', editable: true, required: true },
  // Existing marketing customer identity is its tenant-unique customer code.
  { key: 'customerCode', label: '客户', type: 'reference', editable: true, filterBinding: { kind: 'relation', referenceResource: logisticsResource, valueField: 'customer_code', labelField: 'customer_code' } },
  { key: 'ownerUserId', label: '物流负责人', type: 'member', editable: true },
  { key: 'shipmentDate', label: '出运日期', type: 'date', editable: true },
  { key: 'totalFee', label: '费用合计', type: 'number', format: 'currency', exactNumeric: true, editable: false },
  { key: 'orderNumber', label: '订单号', type: 'text', editable: true }
];
export const logisticsFields: TablePermissionFieldDefinition[] = [...logisticsBusinessFields,
  { key: 'orderNumbers', label: '关联订单汇总', type: 'text', editable: false },
  { key: 'createdBy', label: '创建人', type: 'member', format: 'auditActor', editable: false, printable: true },
  { key: 'createdAt', label: '创建时间', type: 'datetime', editable: false, printable: true },
  { key: 'updatedBy', label: '更新人', type: 'member', format: 'auditActor', editable: false, printable: true },
  { key: 'updatedAt', label: '更新时间', type: 'datetime', editable: false, printable: true }
];
export type LogisticsValues = Record<string, string | null>;
export type LogisticsShipment = { master: LogisticsValues; details: LogisticsValues[] };
export type LogisticsImportError = { row: number; field: string; reason: string; values?: Array<{ row: number; value: string }> };
export type LogisticsImportPreview = { total: number; shipments: number; errors: LogisticsImportError[]; rows: Array<{ row: number; values: LogisticsValues }>; token: string | null };
