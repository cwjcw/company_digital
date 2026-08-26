import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  CustomerDataSnapshot, CustomerImportActor, CustomerImportRepository,
  KDOS_CUSTOMER_IMPORT_REPOSITORY, LEGACY_CUSTOMER_IMPORT_REPOSITORY, NormalizedCustomerImport
} from "./customer-import.types";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const supportedSources = new Set(["tplus", "e10"]);

@Injectable()
export class CustomerImportApplicationService {
  constructor(
    @Inject(LEGACY_CUSTOMER_IMPORT_REPOSITORY) private readonly legacy: CustomerImportRepository,
    @Inject(KDOS_CUSTOMER_IMPORT_REPOSITORY) private readonly kdos: CustomerImportRepository
  ) {}

  private text(value: unknown, label: string, required = false) {
    const text = String(value ?? "").trim();
    if (!text && required) throw new BadRequestException(`${label}不能为空`);
    return text || null;
  }

  private date(value: unknown, label: string) {
    if (value == null || value === "") return null;
    const date = String(value).slice(0, 10);
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!datePattern.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException(`${label}日期格式无效`);
    }
    return date;
  }

  private decimal(value: unknown, label: string, required = false) {
    if (value == null || value === "") {
      if (required) throw new BadRequestException(`${label}不能为空`);
      return null;
    }
    const normalized = String(value).replace(/,/g, "");
    if (!Number.isFinite(Number(normalized))) throw new BadRequestException(`${label}必须为数字`);
    return normalized;
  }

  private normalize(input: CustomerDataSnapshot): NormalizedCustomerImport {
    if (input?.schemaVersion !== 1) throw new BadRequestException("不支持的客户快照版本");
    const source = String(input.source ?? "").toLowerCase() as "tplus" | "e10";
    if (!supportedSources.has(source)) throw new BadRequestException("source 仅支持 tplus 或 e10");
    const sourceDatabase = this.text(input.sourceDatabase, "来源数据库", true)!;
    const sourceAccountName = this.text(input.sourceAccountName, "来源账套", true)!;
    const idempotencyKey = this.text(input.idempotencyKey, "幂等键", true)!;
    if (idempotencyKey.length > 160) throw new BadRequestException("幂等键不能超过160个字符");
    if (!input.scope || !["customer", "all"].includes(input.scope.mode)) throw new BadRequestException("导入范围无效");
    const customerCode = input.scope.mode === "customer" ? this.text(input.scope.customerCode, "客户代码", true)! : null;
    if (!Array.isArray(input.orders) || !input.orders.length) throw new BadRequestException("源查询没有返回订单，已拒绝空快照");
    if (!Array.isArray(input.movements)) throw new BadRequestException("出入库流水必须为数组");
    if (input.orders.length > 250_000 || input.movements.length > 1_000_000) throw new BadRequestException("单次快照超过安全上限，请按客户拆分导入");

    const detailKeys = new Set<string>();
    const orders = input.orders.map((row, index) => {
      const sourceDetailId = this.text(row.sourceDetailId, `第${index + 1}条订单明细来源ID`, true)!;
      if (detailKeys.has(sourceDetailId)) throw new BadRequestException(`订单明细来源ID重复：${sourceDetailId}`);
      detailKeys.add(sourceDetailId);
      const normalized = {
        ...row,
        sourceOrderId: this.text(row.sourceOrderId, `第${index + 1}条订单来源ID`, true)!, sourceDetailId,
        orderNumber: this.text(row.orderNumber, `第${index + 1}条订单号`, true)!, orderDate: this.date(row.orderDate, "订单日期"),
        customerCode: this.text(row.customerCode, "客户代码"), customerName: this.text(row.customerName, "客户名称"),
        salesperson: this.text(row.salesperson, "业务员"), itemNumber: this.text(row.itemNumber, "品项编码", true)!,
        itemName: this.text(row.itemName, "品项名称"), specification: this.text(row.specification, "规格型号"),
        quantity: this.decimal(row.quantity, "订单数量", true)!, baseQuantity: this.decimal(row.baseQuantity, "主计量数量"),
        taxPrice: this.decimal(row.taxPrice, "含税单价"), taxAmount: this.decimal(row.taxAmount, "含税金额"),
        headerTaxAmount: this.decimal(row.headerTaxAmount, "订单金额"), deliveredQuantity: this.decimal(row.deliveredQuantity, "已销货数量"),
        saleOutQuantity: this.decimal(row.saleOutQuantity, "已出库数量"), executedQuantity: this.decimal(row.executedQuantity, "累计执行量"),
        manufactureQuantity: this.decimal(row.manufactureQuantity, "生产待入量"), deliveryDate: this.date(row.deliveryDate, "产前评审交期"),
        auditedAt: row.auditedAt ? new Date(row.auditedAt).toISOString() : null,
        unit: this.text(row.unit, "单位"), warehouseCode: this.text(row.warehouseCode, "仓库"), maker: this.text(row.maker, "制单人"),
        auditor: this.text(row.auditor, "审核人"), memo: this.text(row.memo, "备注"),
        isCancelled: Boolean(row.isCancelled), headerClosed: Boolean(row.headerClosed), lineClosed: Boolean(row.lineClosed)
      };
      if (customerCode && normalized.customerCode !== customerCode) throw new BadRequestException(`订单 ${normalized.orderNumber} 不属于客户 ${customerCode}`);
      return normalized;
    });

    const movementKeys = new Set<string>();
    const movements = input.movements.map((row, index) => {
      const sourceDetailId = this.text(row.sourceDetailId, `第${index + 1}条流水来源ID`, true)!;
      if (movementKeys.has(sourceDetailId)) throw new BadRequestException(`出入库流水来源ID重复：${sourceDetailId}`);
      movementKeys.add(sourceDetailId);
      if (!["INBOUND", "OUTBOUND"].includes(row.direction)) throw new BadRequestException(`流水 ${sourceDetailId} 的方向无效`);
      return {
        ...row, sourceDetailId, sourceDocumentId: this.text(row.sourceDocumentId, "出入库单来源ID", true)!,
        documentNumber: this.text(row.documentNumber, "出入库单号", true)!, documentDate: this.date(row.documentDate, "出入库日期"),
        itemNumber: this.text(row.itemNumber, "出入库品项编码", true)!, itemName: this.text(row.itemName, "品项名称"),
        specification: this.text(row.specification, "规格型号"), quantity: this.decimal(row.quantity, "出入库数量"),
        baseQuantity: this.decimal(row.baseQuantity, "出入库主计量数量"), unitPrice: this.decimal(row.unitPrice, "出入库单价"),
        amount: this.decimal(row.amount, "出入库金额"), partnerCode: this.text(row.partnerCode, "往来单位编码"),
        partnerName: this.text(row.partnerName, "往来单位名称"), unit: this.text(row.unit, "计量单位"),
        warehouseCode: this.text(row.warehouseCode, "仓库编码"), warehouseName: this.text(row.warehouseName, "仓库名称"),
        batch: this.text(row.batch, "批号"), salesOrderNumber: this.text(row.salesOrderNumber, "销售订单号"),
        salesOrderDetailId: this.text(row.salesOrderDetailId, "销售订单明细ID"), sourceDocumentNumber: this.text(row.sourceDocumentNumber, "来源单号"),
        sourceDocumentIdRef: this.text(row.sourceDocumentIdRef, "来源单据ID"), sourceDetailIdRef: this.text(row.sourceDetailIdRef, "来源明细ID"),
        maker: this.text(row.maker, "制单人"), auditor: this.text(row.auditor, "审核人"), memo: this.text(row.memo, "备注")
      };
    });

    return {
      ...input, source, sourceSystem: source === "tplus" ? "TPLUS" : "E10", sourceDatabase, sourceAccountName,
      division: this.text(input.division, "事业部"), customerCode, idempotencyKey, orders, movements,
      extractedAt: new Date(input.extractedAt).toISOString(), replaceDemoData: Boolean(input.replaceDemoData)
    } as NormalizedCustomerImport;
  }

  async importSnapshot(input: CustomerDataSnapshot, actor: CustomerImportActor) {
    const snapshot = this.normalize(input);
    const legacy = await this.legacy.replace(snapshot, actor);
    try {
      const kdos = await this.kdos.replace(snapshot, actor);
      return { idempotencyKey: snapshot.idempotencyKey, source: snapshot.source, sourceDatabase: snapshot.sourceDatabase,
        scope: snapshot.scope, extractedAt: snapshot.extractedAt, legacy, kdos };
    } catch (error) {
      throw new BadRequestException({ message: "旧库已写入，但 KDOS 新库写入失败；快照可使用同一幂等键安全重试", legacy,
        detail: error instanceof Error ? error.message : String(error) });
    }
  }
}
