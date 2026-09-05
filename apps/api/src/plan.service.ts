import { createHash } from "node:crypto";
import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { milestoneProcessCodes, monthlyPlanColumns } from "@tracker/shared";
import {
  AuditLog, DictionaryType, DictionaryValue, IdempotencyRecord, ItemProcessProgress, Order, OrderItem,
  OutsourcingDetail, PlanPeriod, ProcessDefinitionEntity, Supplier
} from "./entities";
import { DomainService } from "./domain.service";
import { PlanGateway } from "./gateway";

const itemFieldMap: Record<string, keyof OrderItem> = {
  customerDueDate: "customerDueDate", reviewDueDate: "reviewDueDate",
  exceptionDueDate: "exceptionDueDate", exceptionDeliveryMethod: "exceptionDeliveryMethod",
  customer: "customer", division: "division",
  containerDate: "containerDate", modelAge: "modelAge",
  productAttribute: "productAttribute", surfaceNature: "surfaceNature", specialItem: "specialItem",
  productionQuantity: "productionQuantity", historicalInboundQuantity: "historicalInboundQuantity",
  todayInboundQuantity: "todayInboundQuantity", handlingMethod: "handlingMethod", planPage: "planPage",
  orderException: "orderException", inspection: "inspection", inspectionQuantity: "inspectionQuantity",
  remark: "remark", orderWeeks: "orderWeeks", unitPrice: "unitPrice"
};
const dictionaryFieldMap: Record<string, string> = {
  exceptionDeliveryMethod: "deliveryMethod",
  modelAge: "modelAge",
  productAttribute: "productAttribute",
  surfaceNature: "surfaceNature",
  specialItem: "specialItem",
  handlingMethod: "handlingMethod",
  "outsourcing.method": "outsourcingMethod",
  division: "division"
};

@Injectable()
export class PlanService {
  constructor(
    @InjectRepository(PlanPeriod) private readonly periods: Repository<PlanPeriod>,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem) private readonly items: Repository<OrderItem>,
    @InjectRepository(OutsourcingDetail) private readonly outsourcing: Repository<OutsourcingDetail>,
    @InjectRepository(ProcessDefinitionEntity) private readonly processDefs: Repository<ProcessDefinitionEntity>,
    @InjectRepository(ItemProcessProgress) private readonly progress: Repository<ItemProcessProgress>,
    @InjectRepository(AuditLog) private readonly audits: Repository<AuditLog>,
    @InjectRepository(IdempotencyRecord) private readonly idempotency: Repository<IdempotencyRecord>,
    private readonly domain: DomainService,
    private readonly dataSource: DataSource,
    private readonly gateway: PlanGateway
  ) {}

  private hasUnrestrictedPlanningScope(user: any) {
    return user.divisions === "*" || user.isSystemAdmin === true
      || user.moduleAdminCodes?.some((code: string) => code === "planning" || code === "cockpit");
  }

  /**
   * Dashboard table permissions also carry a row-data scope. Keep this
   * resource-specific so VIEW_ALL on a dashboard cannot accidentally grant
   * unrestricted write scope to planning tables.
   */
  private hasUnrestrictedDashboardScope(user: any) {
    if (this.hasUnrestrictedPlanningScope(user)) return true;
    return Array.isArray(user.tableDataScopes) && user.tableDataScopes.some((scope: any) =>
      scope?.resource === "sales-summary-dashboard"
      && scope?.scope === "ALL"
      && (!Array.isArray(scope.actions) || scope.actions.includes("read"))
    );
  }

  private scope(user: any, alias = "o") {
    if (this.hasUnrestrictedPlanningScope(user)) return { clause: "1=1", params: {} };
    if (!Array.isArray(user.divisions) || user.divisions.length === 0) return { clause: "1=0", params: {} };
    return { clause: `${alias}.division IN (:...divisions)`, params: { divisions: user.divisions } };
  }

  private isNestedField(field: string) {
    return /^outsourcing\.(supplier|method|dueDate|exceptionDueDate)$/.test(field)
      || /^processes\.[a-zA-Z0-9]+\.(requiredDays|dueDate|quantity|status|exception)$/.test(field);
  }

  private itemStatus(item: OrderItem, processes: Record<string, any>) {
    const statuses = milestoneProcessCodes.map((code) => this.domain.milestoneStatus(processes[code], item.productionQuantity));
    return this.domain.itemStatus(item, statuses);
  }

  private async normalizeDictionaryValue(manager: EntityManager, field: string, value: unknown) {
    const normalized = value === "" || value == null ? null : String(value).trim();
    if (normalized === null) return null;
    if (field === "outsourcing.supplier") {
      const supplier = await manager.findOne(Supplier, { where: { name: normalized, enabled: true } });
      if (!supplier) throw new BadRequestException("外协供应商只能选择供应商表中的启用项");
      return normalized;
    }
    const dictionaryCode = dictionaryFieldMap[field];
    if (!dictionaryCode) return value;
    const type = await manager.findOne(DictionaryType, { where: { code: dictionaryCode } });
    const dictionaryValue = type
      ? await manager.findOne(DictionaryValue, { where: { typeId: type.id, value: normalized, enabled: true } })
      : null;
    if (!dictionaryValue) {
      const header = monthlyPlanColumns.find((column) => column.key === field)?.header ?? field;
      throw new BadRequestException(`${header}只能选择字典中的有效值`);
    }
    return normalized;
  }

  private async applyNestedChange(manager: any, item: OrderItem, field: string, value: unknown) {
    const normalized = await this.normalizeDictionaryValue(manager, field, value);
    const outsourcingMatch = /^outsourcing\.(supplier|method|dueDate|exceptionDueDate)$/.exec(field);
    if (outsourcingMatch) {
      const key = outsourcingMatch[1]!;
      let detail = await manager.findOne(OutsourcingDetail, { where: { orderItemId: item.id } });
      if (!detail) detail = manager.create(OutsourcingDetail, { orderItemId: item.id });
      const before = { [field]: (detail as any)[key] ?? null };
      (detail as any)[key] = normalized;
      await manager.save(detail);
      return before;
    }
    const [, code, key] = /^processes\.([a-zA-Z0-9]+)\.(requiredDays|dueDate|quantity|status|exception)$/.exec(field)!;
    if (key === "status" && milestoneProcessCodes.includes(code as typeof milestoneProcessCodes[number])) {
      throw new BadRequestException("关键工序状态由数量、订单需求数量和交期自动计算，不允许手工修改");
    }
    const definition = await manager.findOne(ProcessDefinitionEntity, { where: { code } });
    if (!definition) throw new BadRequestException(`Unknown process field: ${field}`);
    let record = await manager.findOne(ItemProcessProgress, { where: { orderItemId: item.id, processDefinitionId: definition.id } });
    if (!record) record = manager.create(ItemProcessProgress, { orderItemId: item.id, processDefinitionId: definition.id });
    const before = { [field]: (record as any)[key!] ?? null };
    (record as any)[key!] = normalized;
    record.version += 1;
    await manager.save(record);
    return before;
  }

  private async updateNestedCell(id: string, body: { field: string; value: unknown; expectedVersion: number }, user: any, requestId: string) {
    const item = await this.items.findOne({ where: { id }, relations: { order: true } });
    if (!item) throw new NotFoundException("Item does not exist");
    if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) throw new ForbiddenException("Division is out of scope");
    if (item.version !== body.expectedVersion) throw new ConflictException({ message: "Record has changed", currentVersion: item.version, submittedVersion: body.expectedVersion, field: body.field });
    let before: Record<string, unknown> = {};
    await this.dataSource.transaction(async (manager) => {
      before = await this.applyNestedChange(manager, item, body.field, body.value);
      item.version += 1;
      await manager.save(item);
      await manager.save(AuditLog, {
        actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: id,
        action: "update", beforeJson: before, afterJson: { [body.field]: body.value }, requestId, source: "web"
      });
    });
    const changed = { id, field: body.field, value: body.value, version: item.version };
    this.gateway.broadcast(item.periodId, item.division, changed);
    return changed;
  }

  async periodsList() {
    return this.periods.find({ order: { year: "DESC", month: "DESC" } });
  }

  async createItem(body: { year: number; month: number; orderNumber: string; itemNumber: string; itemName?: string; customer?: string; division?: string }, user: any, requestId: string) {
    const period = await this.periods.findOneBy({ year: body.year, month: body.month });
    if (!period) throw new BadRequestException("Plan period does not exist");
    const division = await this.normalizeDictionaryValue(this.dataSource.manager, "division", body.division) as string | null;
    const order = await this.orders.save({ orderNumber: body.orderNumber.trim(), customer: body.customer?.trim() || null, division });
    const item = await this.items.save({
      orderId: order.id, periodId: period.id, itemNumber: body.itemNumber.trim(),
      itemName: body.itemName?.trim() || null, relationKey: `${order.orderNumber}${body.itemNumber.trim()}`,
      customer: body.customer?.trim() || null, division, month: period.month, active: true, version: 1
    });
    await this.audits.save({ actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id, action: "create", beforeJson: null, afterJson: item, requestId, source: "web" });
    return item;
  }

  async deleteItems(ids: string[], user: any, requestId: string) {
    if (!ids.length) throw new BadRequestException("No rows selected");
    const rows = await this.items.find({ where: ids.map((id) => ({ id })), relations: { order: true } });
    for (const item of rows) {
      if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) throw new ForbiddenException("Division is out of scope");
      item.active = false; item.version += 1; await this.items.save(item);
      await this.audits.save({ actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id, action: "delete", beforeJson: { active: true }, afterJson: { active: false }, requestId, source: "web" });
    }
    return { affected: rows.length };
  }

  async moveItems(
    ids: string[], targetYear: number, targetMonth: number, user: any, requestId: string
  ) {
    const uniqueIds = [...new Set(ids ?? [])];
    if (!uniqueIds.length || uniqueIds.length > 500) {
      throw new BadRequestException("请选择 1 至 500 个需要调整月份的品号");
    }
    if (!Number.isInteger(targetYear) || targetYear < 2000 || targetYear > 2200
      || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      throw new BadRequestException("目标年月无效");
    }
    if (!(user.permissions?.includes("*") || user.permissions?.some((permission: string) =>
      permission === "monthly-plan:*:update" || permission === "monthly-plan:month:update"))) {
      throw new ForbiddenException("没有调整月度计划的权限");
    }

    const result = await this.dataSource.transaction(async (manager) => {
      let target = await manager.findOneBy(PlanPeriod, { year: targetYear, month: targetMonth });
      target ??= await manager.save(PlanPeriod, { year: targetYear, month: targetMonth, status: "active" });
      const rows = await manager.find(OrderItem, {
        where: uniqueIds.map((id) => ({ id })),
        relations: { order: true, period: true }
      });
      if (rows.length !== uniqueIds.length) throw new NotFoundException("部分品号不存在或已被删除");

      const changes: Array<{ id: string; oldPeriodId: string; division: string | null; version: number }> = [];
      let skipped = 0;
      for (const item of rows) {
        if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) {
          throw new ForbiddenException("超出事业部数据范围");
        }
        if (item.periodId === target.id) {
          skipped += 1;
          continue;
        }
        const conflict = await manager.createQueryBuilder(OrderItem, "targetItem")
          .innerJoin("targetItem.order", "targetOrder")
          .where("targetItem.periodId = :periodId", { periodId: target.id })
          .andWhere("targetItem.active = true")
          .andWhere("targetItem.itemNumber = :itemNumber", { itemNumber: item.itemNumber })
          .andWhere("targetOrder.orderNumber = :orderNumber", { orderNumber: item.order.orderNumber })
          .andWhere("targetItem.id <> :id", { id: item.id })
          .getOne();
        if (conflict) {
          throw new ConflictException(
            `目标月份已存在订单号 ${item.order.orderNumber}、品号 ${item.itemNumber}，未执行调整`
          );
        }
        const oldPeriodId = item.periodId;
        const before = { year: item.period.year, month: item.period.month, periodId: oldPeriodId };
        item.periodId = target.id;
        item.period = target;
        item.month = target.month;
        item.version += 1;
        await manager.save(item);
        await manager.save(AuditLog, {
          actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id,
          action: "move-period", beforeJson: before,
          afterJson: { year: target.year, month: target.month, periodId: target.id },
          requestId, source: "web"
        });
        changes.push({ id: item.id, oldPeriodId, division: item.division, version: item.version });
      }
      return { target, changes, skipped };
    });

    for (const change of result.changes) {
      const payload = {
        id: change.id, action: "move-period",
        targetYear: result.target.year, targetMonth: result.target.month, version: change.version
      };
      this.gateway.broadcast(change.oldPeriodId, change.division, payload);
      this.gateway.broadcast(result.target.id, change.division, payload);
    }
    return {
      moved: result.changes.length, skipped: result.skipped,
      target: { id: result.target.id, year: result.target.year, month: result.target.month }
    };
  }

  async monthly(year: number, month: number, user: any) {
    const period = await this.periods.findOneBy({ year, month });
    if (!period) return { period: null, columns: monthlyPlanColumns, rows: [] };
    const scope = this.scope(user, "i");
    const items = await this.items.createQueryBuilder("i")
      .innerJoinAndSelect("i.order", "o")
      .where("i.periodId = :periodId", { periodId: period.id })
      .andWhere(scope.clause, scope.params)
      .andWhere("i.active = true")
      .orderBy("o.orderNumber", "ASC").addOrderBy("i.itemNumber", "ASC").getMany();
    const itemIds = items.map((item) => item.id);
    const outs = itemIds.length ? await this.outsourcing.createQueryBuilder("x").where("x.orderItemId IN (:...ids)", { ids: itemIds }).getMany() : [];
    const defs = await this.processDefs.find({ order: { sortOrder: "ASC" } });
    const progresses = itemIds.length ? await this.progress.createQueryBuilder("p").where("p.orderItemId IN (:...ids)", { ids: itemIds }).getMany() : [];
    const outMap = new Map(outs.map((out) => [out.orderItemId, out]));
    const defMap = new Map(defs.map((def) => [def.id, def]));
    return {
      period, columns: monthlyPlanColumns,
      rows: items.map((item, index) => {
        const metrics = this.domain.itemMetrics(item);
        const processes: Record<string, any> = {};
        for (const entry of progresses.filter((p) => p.orderItemId === item.id)) {
          const def = defMap.get(entry.processDefinitionId);
          if (def) processes[def.code] = entry;
        }
        for (const code of milestoneProcessCodes) {
          const current = processes[code] ?? {};
          processes[code] = { ...current, status: this.domain.milestoneStatus(current, item.productionQuantity) };
        }
        return {
          ...item,
          id: item.id, sequence: index + 1, version: item.version,
          month: `${period.year}-${String(period.month).padStart(2, "0")}`,
          orderVersion: item.order.version, orderNumber: item.order.orderNumber,
          orderDate: item.order.orderDate, customerDueDate: item.customerDueDate,
          reviewDueDate: item.reviewDueDate, exceptionDueDate: item.exceptionDueDate,
          exceptionDeliveryMethod: item.exceptionDeliveryMethod,
          customer: item.customer, division: item.division,
          itemStatus: this.itemStatus(item, processes),
          balanceQuantity: metrics.balanceQuantity,
          inboundAmount: metrics.inboundAmount, balanceAmount: metrics.balanceAmount,
          warnings: metrics.warnings, outsourcing: outMap.get(item.id) ?? null, processes
        };
      })
    };
  }

  private async rollingRows(orders: Order[]) {
    if (!orders.length) return [];
    const records = await this.items.createQueryBuilder("i")
      .innerJoinAndSelect("i.order", "o")
      .where("i.active = true")
      .andWhere("i.orderId IN (:...orderIds)", { orderIds: orders.map((order) => order.id) })
      .orderBy("o.orderNumber", "ASC").getMany();
    const periodRows = await this.periods.find();
    const periodMap = new Map(periodRows.map((period) => [period.id, `${period.year}-${String(period.month).padStart(2, "0")}`]));
    const grouped = new Map<string, OrderItem[]>();
    for (const item of records) grouped.set(item.orderId, [...(grouped.get(item.orderId) ?? []), item]);
    return orders.map((order) => {
      const items = grouped.get(order.id) ?? [];
      const months = [...new Set(items.map((item) => periodMap.get(item.periodId)).filter(Boolean))].sort();
      return { id: order.id, orderNumber: order.orderNumber, orderType: order.orderType, orderDate: order.orderDate, month: months.join("、"), months,
        sourceAccountName: order.sourceAccountName, sourceDatabase: order.sourceDatabase,
        customerDueDate: order.customerDueDate, reviewDueDate: order.reviewDueDate,
        exceptionDueDate: order.exceptionDueDate, exceptionDeliveryMethod: order.exceptionDeliveryMethod,
        customer: order.customer, salesperson: order.salesperson,
        orderAmount: order.orderAmount ?? this.domain.orderAmount(items), division: order.division,
        actualCompletionDate: order.actualCompletionDate, shippingDate: order.shippingDate,
        deliveryScore: order.deliveryScore, qualityScore: order.qualityScore,
        version: order.version, createdBy: order.createdBy, createdAt: order.createdAt, updatedBy: order.updatedBy, updatedAt: order.updatedAt,
        ...this.domain.orderMetrics(items, order.sourceTotalQuantity) };
    });
  }

  async rolling(user: any) {
    const scope = this.scope(user);
    const orders = await this.orders.createQueryBuilder("o")
      .where(scope.clause, scope.params)
      .andWhere("o.sourceActive = true")
      .orderBy("o.orderNumber", "ASC").getMany();
    return this.rollingRows(orders);
  }

  async rollingPage(input: { page?: number; pageSize?: number; search?: string; filters?: Array<{ field: string; value: string }>; quickFilters?: Record<string, unknown>; sortField?: string; sortOrder?: "asc" | "desc" }, user: any) {
    const page = Math.max(Number(input.page) || 1, 1);
    const pageSize = [20, 50, 100, 200].includes(Number(input.pageSize)) ? Number(input.pageSize) : 50;
    const filters = Array.isArray(input.filters) ? input.filters.filter((entry) => entry?.field && String(entry.value ?? "").trim()) : [];
    const quick = input.quickFilters ?? {};
    const directFields: Record<string, { column: string; dictionary?: boolean }> = {
      sourceAccountName: { column: "source_account_name" }, orderType: { column: "order_type", dictionary: true },
      customer: { column: "customer" }, salesperson: { column: "salesperson" }, orderNumber: { column: "order_number" },
      orderDate: { column: "order_date" }, customerDueDate: { column: "customer_due_date" }, reviewDueDate: { column: "review_due_date" },
      exceptionDueDate: { column: "exception_due_date" }, exceptionDeliveryMethod: { column: "exception_delivery_method", dictionary: true },
      orderAmount: { column: "order_amount" }, division: { column: "division", dictionary: true },
      actualCompletionDate: { column: "actual_completion_date" }, shippingDate: { column: "shipping_date" },
      deliveryScore: { column: "delivery_score" }, qualityScore: { column: "quality_score" }, createdBy: { column: "created_by" }, updatedBy: { column: "updated_by" }
    };
    const sortField = String(input.sortField ?? "");
    const requiresDerivedFilter = filters.some((entry) => !directFields[entry.field])
      || quick.completionRateStart != null || quick.completionRateEnd != null || Boolean(sortField && !directFields[sortField]);
    const valueAt = (row: Record<string, unknown>, path: string) => path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
    const matches = (row: Record<string, unknown>) => {
      for (const filter of filters) {
        const actual = String(valueAt(row, filter.field) ?? ""); const expected = String(filter.value).trim();
        if (directFields[filter.field]?.dictionary ? actual !== expected : !actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase())) return false;
      }
      const dateMatches = (value: unknown, start: unknown, end: unknown) => Boolean(value) && (!start || String(value) >= String(start)) && (!end || String(value) <= String(end));
      const completion = row.completionRate == null ? null : Number(row.completionRate) * 100;
      return (!quick.orderNumber || String(row.orderNumber ?? "").toLocaleLowerCase().includes(String(quick.orderNumber).toLocaleLowerCase()))
        && (!quick.month || String(row.month ?? "").includes(String(quick.month)))
        && (!quick.customerDueDateStart && !quick.customerDueDateEnd || dateMatches(row.customerDueDate, quick.customerDueDateStart, quick.customerDueDateEnd))
        && (!quick.reviewDueDateStart && !quick.reviewDueDateEnd || dateMatches(row.reviewDueDate, quick.reviewDueDateStart, quick.reviewDueDateEnd))
        && (!quick.exceptionDueDateStart && !quick.exceptionDueDateEnd || dateMatches(row.exceptionDueDate, quick.exceptionDueDateStart, quick.exceptionDueDateEnd))
        && (quick.completionRateStart == null || completion != null && completion >= Number(quick.completionRateStart))
        && (quick.completionRateEnd == null || completion != null && completion <= Number(quick.completionRateEnd))
        && (!quick.customer || String(row.customer ?? "").toLocaleLowerCase().includes(String(quick.customer).toLocaleLowerCase()))
        && (!quick.division || row.division === quick.division);
    };
    if (requiresDerivedFilter) {
      const all = (await this.rolling(user)).filter((row) => matches(row as Record<string, unknown>));
      if (sortField) all.sort((left, right) => {
        const compared = String(valueAt(left as Record<string, unknown>, sortField) ?? "").localeCompare(String(valueAt(right as Record<string, unknown>, sortField) ?? ""), "zh-CN", { numeric: true });
        return input.sortOrder === "desc" ? -compared : compared;
      });
      return { rows: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
    }
    const scope = this.scope(user);
    const query = this.orders.createQueryBuilder("o").where(scope.clause, scope.params).andWhere("o.sourceActive = true");
    if (input.search?.trim()) query.andWhere("concat_ws(' ',o.order_number,o.customer,o.salesperson,o.division,o.source_account_name) ILIKE :rollingSearch", { rollingSearch: `%${input.search.trim()}%` });
    for (const [index, filter] of filters.entries()) {
      const config = directFields[filter.field]!; const key = `rollingFilter${index}`;
      query.andWhere(config.dictionary ? `o.${config.column} = :${key}` : `CAST(o.${config.column} AS text) ILIKE :${key}`, { [key]: config.dictionary ? filter.value : `%${filter.value.trim()}%` });
    }
    const contains = (property: string, value: unknown, key: string) => { if (value) query.andWhere(`o.${property} ILIKE :${key}`, { [key]: `%${String(value).trim()}%` }); };
    contains("order_number", quick.orderNumber, "quickOrderNumber"); contains("customer", quick.customer, "quickCustomer");
    if (quick.division) query.andWhere("o.division = :quickDivision", { quickDivision: quick.division });
    const range = (property: string, start: unknown, end: unknown, key: string) => { if (start) query.andWhere(`o.${property} >= :${key}Start`, { [`${key}Start`]: start }); if (end) query.andWhere(`o.${property} <= :${key}End`, { [`${key}End`]: end }); };
    range("customer_due_date", quick.customerDueDateStart, quick.customerDueDateEnd, "customerDue");
    range("review_due_date", quick.reviewDueDateStart, quick.reviewDueDateEnd, "reviewDue");
    range("exception_due_date", quick.exceptionDueDateStart, quick.exceptionDueDateEnd, "exceptionDue");
    if (quick.month) query.andWhere(`EXISTS (SELECT 1 FROM order_items ri JOIN plan_periods rp ON rp.id=ri.period_id WHERE ri.order_id=o.id AND ri.active=true AND concat(rp.year,'-',lpad(rp.month::text,2,'0'))=:quickMonth)`, { quickMonth: quick.month });
    const total = await query.getCount();
    const directSort = directFields[sortField];
    const orders = await query.orderBy(directSort ? `o.${directSort.column}` : "o.orderNumber", input.sortOrder === "desc" ? "DESC" : "ASC", "NULLS LAST").skip((page - 1) * pageSize).take(pageSize).getMany();
    return { rows: await this.rollingRows(orders), total, page, pageSize };
  }

  private dashboardDateRange(dimension: "year" | "month" | "day", period: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) throw new BadRequestException("驾驶舱日期格式无效");
    const [year, month, day] = period.split("-").map(Number);
    const parsed = new Date(Date.UTC(year!, month! - 1, day!));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month! - 1 || parsed.getUTCDate() !== day) throw new BadRequestException("驾驶舱日期无效");
    const start = dimension === "year" ? new Date(Date.UTC(year!,0,1)) : dimension === "month" ? new Date(Date.UTC(year!,month!-1,1)) : parsed;
    const end = new Date(start);
    if (dimension === "year") end.setUTCFullYear(end.getUTCFullYear()+1);
    else if (dimension === "month") end.setUTCMonth(end.getUTCMonth()+1);
    else end.setUTCDate(end.getUTCDate()+1);
    return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)] as const;
  }

  async salesDashboard(input: { dimension: "year" | "month" | "day"; period: string; divisions?: string[]; customers?: string[] }, user: any) {
    if (!["year","month","day"].includes(input.dimension)) throw new BadRequestException("驾驶舱时间维度无效");
    const [start,end]=this.dashboardDateRange(input.dimension,input.period);
    const params: unknown[]=[start,end]; const clauses=["o.source_active=true","o.order_date>=$1::date","o.order_date<$2::date"];const selectedClauses:string[]=[];
    if (!this.hasUnrestrictedDashboardScope(user)) {
      if (!Array.isArray(user.divisions) || !user.divisions.length) return {generatedAt:new Date().toISOString(),metrics:{orderCount:0,orderAmount:"0",totalQuantity:"0",completedQuantity:"0",pendingQuantity:"0",completionRate:0},statusCounts:{"已完成":0,"进行中":0,"即将延期":0,"延期":0},divisionRows:[],warningRows:[],filters:{divisions:[],customers:[]}};
      params.push(user.divisions);clauses.push(`o.division=ANY($${params.length}::varchar[])`);
    }
    const divisions=[...new Set((input.divisions??[]).map(value=>String(value).trim()).filter(Boolean))].slice(0,100);
    const customers=[...new Set((input.customers??[]).map(value=>String(value).trim()).filter(Boolean))].slice(0,100);
    if(divisions.length){params.push(divisions);selectedClauses.push(`o.division=ANY($${params.length}::varchar[])`);}
    if(customers.length){params.push(customers);selectedClauses.push(`o.customer=ANY($${params.length}::varchar[])`);}
    const [row]=await this.dataSource.query(`WITH scoped_orders AS MATERIALIZED (
      SELECT o.* FROM orders o WHERE ${clauses.join(" AND ")}
    ), filtered_orders AS MATERIALIZED (
      SELECT o.* FROM scoped_orders o${selectedClauses.length?` WHERE ${selectedClauses.join(" AND ")}`:""}
    ), item_totals AS (
      SELECT i.order_id,COALESCE(sum(i.production_quantity),0) item_total,
        COALESCE(sum(COALESCE(i.historical_inbound_quantity,0)+COALESCE(i.today_inbound_quantity,0)),0) completed,
        COALESCE(sum(COALESCE(i.production_quantity,0)*COALESCE(i.unit_price,0)),0) item_amount
      FROM order_items i JOIN filtered_orders o ON o.id=i.order_id WHERE i.active=true GROUP BY i.order_id
    ), base AS (
      SELECT o.id,o.order_number,o.order_date,o.customer,o.division,
        COALESCE(o.exception_due_date,o.review_due_date,o.customer_due_date) due_date,
        COALESCE(o.source_total_quantity,t.item_total,0) total_quantity,COALESCE(t.completed,0) completed_quantity,
        COALESCE(o.order_amount,t.item_amount,0) order_amount
      FROM filtered_orders o LEFT JOIN item_totals t ON t.order_id=o.id
    ), decorated AS (
      SELECT base.*,GREATEST(total_quantity-completed_quantity,0) pending_quantity,
        CASE WHEN total_quantity<>0 AND completed_quantity>=total_quantity THEN '已完成'
          WHEN due_date<(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN '延期'
          WHEN due_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN '即将延期' ELSE '进行中' END status
      FROM base
    ), division_summary AS (
      SELECT COALESCE(division,'未指定') division,count(*)::integer orders,sum(order_amount) amount,sum(total_quantity) total,
        sum(completed_quantity) completed,sum(pending_quantity) pending,
        CASE WHEN sum(total_quantity)=0 THEN 0 ELSE round(sum(completed_quantity)/sum(total_quantity)*100,2) END rate
      FROM decorated GROUP BY COALESCE(division,'未指定')
    ), warnings AS (
      SELECT id,order_number,customer,COALESCE(division,'未指定') division,due_date,status,
        due_date-(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date remaining_days
      FROM decorated WHERE status<>'已完成' AND due_date IS NOT NULL
        AND due_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date+3
      ORDER BY due_date,order_number LIMIT 8
    ) SELECT jsonb_build_object(
      'generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'metrics',jsonb_build_object('orderCount',(SELECT count(*)::integer FROM decorated),'orderAmount',(SELECT COALESCE(sum(order_amount),0)::text FROM decorated),
        'totalQuantity',(SELECT COALESCE(sum(total_quantity),0)::text FROM decorated),'completedQuantity',(SELECT COALESCE(sum(completed_quantity),0)::text FROM decorated),
        'pendingQuantity',(SELECT COALESCE(sum(pending_quantity),0)::text FROM decorated),'completionRate',(SELECT CASE WHEN COALESCE(sum(total_quantity),0)=0 THEN 0 ELSE round(sum(completed_quantity)/sum(total_quantity)*100,2) END FROM decorated)),
      'statusCounts',jsonb_build_object('已完成',(SELECT count(*)::integer FROM decorated WHERE status='已完成'),'进行中',(SELECT count(*)::integer FROM decorated WHERE status='进行中'),
        '即将延期',(SELECT count(*)::integer FROM decorated WHERE status='即将延期'),'延期',(SELECT count(*)::integer FROM decorated WHERE status='延期')),
      'divisionRows',COALESCE((SELECT jsonb_agg(jsonb_build_object('division',division,'orders',orders,'amount',amount::text,'total',total::text,
        'completed',completed::text,'pending',pending::text,'rate',rate) ORDER BY pending DESC,division) FROM division_summary),'[]'::jsonb),
      'warningRows',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'orderNumber',order_number,'customer',customer,'division',division,
        'dueDate',due_date,'status',status,'remainingDays',remaining_days) ORDER BY due_date,order_number) FROM warnings),'[]'::jsonb),
      'filters',jsonb_build_object('divisions',COALESCE((SELECT to_jsonb(array_agg(DISTINCT division ORDER BY division)) FROM scoped_orders WHERE division IS NOT NULL),'[]'::jsonb),
        'customers',COALESCE((SELECT to_jsonb(array_agg(DISTINCT customer ORDER BY customer)) FROM scoped_orders WHERE customer IS NOT NULL),'[]'::jsonb))
    ) payload`,params);
    return row.payload;
  }

  private normalizeOrderDate(value: unknown) {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date
      ? value
      : typeof value === "number" && value > 0 && value < 100000
        ? new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000))
        : new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`日期格式无效：${String(value)}`);
    return date.toISOString().slice(0, 10);
  }

  private normalizeOrderDecimal(value: unknown, field: string) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(number)) throw new BadRequestException(`${field}必须为数字`);
    return String(number);
  }

  private async normalizedOrderValues(body: Record<string, unknown>) {
    const values: Record<string, unknown> = {};
    const textFields = ["customer", "salesperson", "orderType"];
    const dateFields = ["customerDueDate", "reviewDueDate", "exceptionDueDate", "actualCompletionDate", "shippingDate"];
    const decimalFields = ["orderAmount", "deliveryScore", "qualityScore"];
    for (const field of textFields) if (field in body) values[field] = String(body[field] ?? "").trim() || null;
    for (const field of dateFields) if (field in body) values[field] = this.normalizeOrderDate(body[field]);
    for (const field of decimalFields) if (field in body) values[field] = this.normalizeOrderDecimal(body[field], field);
    if ("exceptionDeliveryMethod" in body) values.exceptionDeliveryMethod = await this.normalizeDictionaryValue(this.dataSource.manager, "exceptionDeliveryMethod", body.exceptionDeliveryMethod);
    if ("division" in body) values.division = await this.normalizeDictionaryValue(this.dataSource.manager, "division", body.division);
    return values;
  }

  async createOrder(body: Record<string, unknown>, user: any, requestId: string) {
    const orderNumber = String(body.orderNumber ?? "").trim();
    if (!orderNumber) throw new BadRequestException("订单号为必填项");
    if (await this.orders.findOneBy({ orderNumber })) throw new ConflictException("订单号已存在");
    const values = await this.normalizedOrderValues(body);
    const order = await this.orders.save({
      orderNumber,
      orderDate: this.normalizeOrderDate(body.orderDate),
      ...values,
      version: 1
    });
    await this.audits.save({ actorId: user.sub, actorName: user.username, resource: "sales-order-summary", recordId: order.id, action: "create", beforeJson: null, afterJson: order, requestId, source: "web" });
    return order;
  }

  async updateOrder(id: string, body: Record<string, unknown>, user: any, requestId: string) {
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new BadRequestException("expectedVersion 必填");
    const allowed = [
      "customer", "salesperson", "orderType", "customerDueDate", "reviewDueDate", "exceptionDueDate",
      "exceptionDeliveryMethod", "orderAmount", "division", "actualCompletionDate", "shippingDate",
      "deliveryScore", "qualityScore"
    ] as const;
    const rejected = Object.keys(body).filter((field) => field !== "expectedVersion" && !allowed.includes(field as typeof allowed[number]));
    if (rejected.length) throw new BadRequestException(`字段不可编辑：${rejected.join("、")}`);
    const normalized = await this.normalizedOrderValues(body);
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(Order, { where: { id }, lock: { mode: "pessimistic_write" } });
      if (!order) throw new NotFoundException("订单不存在");
      if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(order.division)) throw new ForbiddenException("超出事业部数据范围");
      if (order.version !== expectedVersion) throw new ConflictException({ message: "销售接单已被其他用户修改，请刷新后重试", currentVersion: order.version, submittedVersion: expectedVersion });
      const before: Record<string, unknown> = {};
      for (const field of allowed) if (field in normalized) { before[field] = order[field]; (order as any)[field] = normalized[field]; }
      const changedAt = new Date(); order.version += 1;
      await manager.save(order);
      await manager.save(AuditLog, { actorId: user.sub, actorName: user.username, resource: "rolling-plan", recordId: id, action: "update", beforeJson: before, afterJson: normalized, requestId, source: "web", createdAt: changedAt });
      return order;
    });
  }

  async importOrders(rows: Record<string, unknown>[], user: any, requestId: string) {
    const errors: string[] = [];
    const prepared: Array<{ orderNumber: string; values: Record<string, unknown>; rowNumber: number }> = [];
    const seen = new Map<string, number>();
    if (!rows?.length) errors.push("Excel 中没有可导入的数据行");
    for (const [index, row] of (rows ?? []).entries()) {
      const rowNumber = Number(row.__row) || index + 4;
      const orderNumber = String(row.orderNumber ?? "").trim();
      if (!orderNumber) {
        errors.push(`第 ${rowNumber} 行缺少订单号`);
        continue;
      }
      if (seen.has(orderNumber)) {
        errors.push(`第 ${rowNumber} 行订单号“${orderNumber}”与第 ${seen.get(orderNumber)} 行重复`);
        continue;
      }
      seen.set(orderNumber, rowNumber);
      try {
        prepared.push({
          orderNumber,
          rowNumber,
          values: { orderDate: this.normalizeOrderDate(row.orderDate), ...(await this.normalizedOrderValues(row)) }
        });
      } catch (error) {
        const response = error instanceof BadRequestException ? error.getResponse() : null;
        const detail = typeof response === "string" ? response : (response as any)?.message;
        errors.push(`第 ${rowNumber} 行：${Array.isArray(detail) ? detail.join("；") : detail || (error as Error).message}`);
      }
    }
    if (errors.length) throw new BadRequestException({ message: `导入校验失败，共 ${errors.length} 处错误，未写入任何数据`, errors: errors.slice(0, 200) });

    await this.dataSource.transaction(async (manager) => {
      for (const row of prepared) {
        const { orderNumber } = row;
        let order = await manager.findOneBy(Order, { orderNumber });
        const next = {
          orderNumber,
          ...row.values,
          version: order ? order.version + 1 : 1
        };
        order = order ? Object.assign(order, next) : manager.create(Order, next);
        order = await manager.save(order);
        await manager.save(AuditLog, {
          actorId: user.sub, actorName: user.username, resource: "sales-order-summary", recordId: order.id,
          action: "import", beforeJson: null, afterJson: next, requestId, source: "import"
        });
      }
    });
    return { imported: prepared.length, skipped: 0, message: `全部校验通过，成功导入 ${prepared.length} 行` };
  }

  async importPlanRows(rows: Array<{ year: number; month: number; orderNumber: string; itemNumber: string; itemName?: string; customer?: string; division?: string }>, user: any, requestId: string) {
    let imported = 0;
    for (const row of rows ?? []) {
      if (!row.orderNumber?.trim() || !row.itemNumber?.trim()) continue;
      const division = await this.normalizeDictionaryValue(this.dataSource.manager, "division", row.division) as string | null;
      let period = await this.periods.findOneBy({ year: Number(row.year), month: Number(row.month) });
      period ??= await this.periods.save({ year: Number(row.year), month: Number(row.month), status: "active" });
      let order = await this.orders.findOneBy({ orderNumber: row.orderNumber.trim() });
      order ??= await this.orders.save({ orderNumber: row.orderNumber.trim(), customer: row.customer?.trim() || null, division });
      const existing = await this.items.findOneBy({ periodId: period.id, orderId: order.id, itemNumber: row.itemNumber.trim() });
      if (existing) {
        existing.itemName = row.itemName?.trim() || existing.itemName;
        existing.customer = row.customer?.trim() || existing.customer;
        existing.division = division ?? existing.division;
        existing.month = period.month;
        existing.active = true;
        await this.items.save(existing);
      } else {
        await this.items.save({
          orderId: order.id, periodId: period.id, itemNumber: row.itemNumber.trim(),
          itemName: row.itemName?.trim() || null, relationKey: `${order.orderNumber}${row.itemNumber.trim()}`,
          customer: row.customer?.trim() || null, division, month: period.month, active: true, version: 1
        });
      }
      imported += 1;
    }
    await this.audits.save({ actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: null, action: "import", beforeJson: null, afterJson: { imported }, requestId, source: "web" });
    return { imported };
  }

  async deleteOrders(ids: string[], user: any, requestId: string) {
    for (const id of ids ?? []) {
      const order = await this.orders.findOneBy({ id });
      if (!order) continue;
      if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(order.division)) throw new ForbiddenException("超出事业部数据范围");
      await this.items.update({ orderId: id }, { active: false });
      await this.audits.save({ actorId: user.sub, actorName: user.username, resource: "rolling-plan", recordId: id, action: "delete", beforeJson: { active: true }, afterJson: { active: false }, requestId, source: "web" });
    }
    return { affected: ids?.length ?? 0 };
  }

  async updateCell(id: string, body: { field: string; value: unknown; expectedVersion: number }, user: any, requestId: string) {
    if (!(user.permissions?.includes("*") || user.permissions?.some((p: string) => p === `monthly-plan:${body.field}:update` || p === "monthly-plan:*:update"))) {
      throw new ForbiddenException("没有修改该字段的权限");
    }
    const item = await this.items.findOne({ where: { id }, relations: { order: true } });
    if (!item) throw new NotFoundException("品号不存在");
    if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) throw new ForbiddenException("超出事业部数据范围");
    if (this.isNestedField(body.field)) return this.updateNestedCell(id, body, user, requestId);
    if (item.version !== body.expectedVersion) {
      throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: item.version, submittedVersion: body.expectedVersion, field: body.field });
    }
    if (!itemFieldMap[body.field]) throw new BadRequestException("字段不可编辑");
    const before = { [body.field]: (item as any)[itemFieldMap[body.field]] };
    await this.dataSource.transaction(async (manager) => {
      (item as any)[itemFieldMap[body.field]] = await this.normalizeDictionaryValue(manager, body.field, body.value);
      item.version += 1;
      await manager.save(item);
      await manager.save(AuditLog, {
        actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: id,
        action: "update", beforeJson: before, afterJson: { [body.field]: body.value },
        requestId, source: "web"
      });
    });
    const changed = { id, field: body.field, value: body.value, version: item.version };
    this.gateway.broadcast(item.periodId, item.division, changed);
    return changed;
  }

  async bulkUpdate(
    updates: Array<{ id: string; field: string; value: unknown; expectedVersion: number }>,
    user: any, requestId: string, idempotencyKey: string
  ) {
    if (!idempotencyKey) throw new BadRequestException("批量写入必须携带 Idempotency-Key");
    if (!updates.length || updates.length > 500) throw new BadRequestException("批量更新数量必须在 1 到 500 之间");
    const requestHash = createHash("sha256").update(JSON.stringify(updates)).digest("hex");
    const previous = await this.idempotency.findOneBy({ key: idempotencyKey });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ConflictException("Idempotency-Key 已用于不同请求");
      return previous.responseJson;
    }
    const response = await this.dataSource.transaction(async (manager) => {
      const results: Array<{ id: string; field: string; value: unknown; version: number }> = [];
      for (const update of updates) {
        if (!(user.permissions?.includes("*") || user.permissions?.some((p: string) => p === `monthly-plan:${update.field}:update` || p === "monthly-plan:*:update"))) {
          throw new ForbiddenException("没有修改该字段的权限");
        }
        const item = await manager.findOne(OrderItem, { where: { id: update.id }, relations: { order: true } });
        if (this.isNestedField(update.field)) {
          if (!item) throw new NotFoundException(`Item does not exist: ${update.id}`);
          if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) throw new ForbiddenException("Division is out of scope");
          if (item.version !== update.expectedVersion) throw new ConflictException({ message: "Record has changed", currentVersion: item.version, submittedVersion: update.expectedVersion, field: update.field });
          const before = await this.applyNestedChange(manager, item, update.field, update.value);
          item.version += 1;
          await manager.save(item);
          await manager.save(AuditLog, {
            actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id,
            action: "bulk-update", beforeJson: before, afterJson: { [update.field]: update.value }, requestId, source: "api"
          });
          results.push({ id: item.id, field: update.field, value: update.value, version: item.version });
          continue;
        }
        if (!itemFieldMap[update.field]) throw new BadRequestException(`字段不可编辑：${update.field}`);
        if (!item) throw new NotFoundException(`品号不存在：${update.id}`);
        if (!this.hasUnrestrictedPlanningScope(user) && !user.divisions.includes(item.division)) throw new ForbiddenException("超出事业部数据范围");
        if (item.version !== update.expectedVersion) {
          throw new ConflictException({ message: "记录已被其他用户修改", currentVersion: item.version, submittedVersion: update.expectedVersion, field: update.field });
        }
        const before = { [update.field]: (item as any)[itemFieldMap[update.field]] };
        (item as any)[itemFieldMap[update.field]] = await this.normalizeDictionaryValue(manager, update.field, update.value);
        item.version += 1;
        await manager.save(item);
        await manager.save(AuditLog, {
          actorId: user.sub, actorName: user.username, resource: "monthly-plan", recordId: item.id,
          action: "bulk-update", beforeJson: before, afterJson: { [update.field]: update.value }, requestId, source: "api"
        });
        results.push({ id: item.id, field: update.field, value: update.value, version: item.version });
      }
      const completed = { results };
      await manager.save(IdempotencyRecord, { key: idempotencyKey, requestHash, responseJson: completed });
      return completed;
    });
    for (const change of response.results) {
      const item = await this.items.findOne({ where: { id: change.id }, relations: { order: true } });
      if (item) this.gateway.broadcast(item.periodId, item.division, change);
    }
    return response;
  }
}
