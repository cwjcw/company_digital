import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DataSource, EntityManager, In } from "typeorm";
import {
  AuditLog, DictionaryType, DictionaryValue, EquipmentAsset, EquipmentResponsible,
  EquipmentStatusReport, IdempotencyRecord, OrganizationUnit, User
} from "../../entities";
import { EquipmentActor, EquipmentStatusImportRow, EquipmentStatusImportSourceRow, equipmentScope, hasEquipmentPermission } from "./equipment.types";

type AssetInput = {
  divisionId: string;
  usageDepartmentId?: string | null;
  usageDepartmentName?: string | null;
  equipmentCode: string;
  equipmentName: string;
  purchaseDate?: string | null;
  monitored?: boolean;
  responsibleUserIds?: string[];
};

type StatusInput = {
  equipmentId: string;
  reportDate: string;
  runtimeMinutes?: number;
  faultMinutes?: number;
  faultReason?: string | null;
};

@Injectable()
export class EquipmentApplicationService {
  constructor(private readonly dataSource: DataSource) {}

  async createAsset(input: AssetInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-register", "create");
    return this.dataSource.transaction((manager) => this.saveAsset(manager, null, input, actor));
  }

  async updateAsset(id: string, input: Partial<AssetInput> & { expectedVersion?: number }, actor: EquipmentActor) {
    this.assert(actor, "equipment-register", "update");
    return this.dataSource.transaction((manager) => this.saveAsset(manager, id, input as AssetInput, actor));
  }

  async disableAsset(id: string, expectedVersion: number, actor: EquipmentActor) {
    this.assert(actor, "equipment-register", "delete");
    return this.dataSource.transaction(async (manager) => {
      const asset = await manager.createQueryBuilder(EquipmentAsset, "asset").setLock("pessimistic_write")
        .where("asset.id=:id AND asset.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
      if (!asset) throw new NotFoundException("设备不存在");
      this.assertDivision(actor, "equipment-register", "delete", asset.divisionOrganizationUnitId);
      if (asset.version !== Number(expectedVersion)) throw new ConflictException("设备已被其他人修改，请刷新后重试");
      const before = this.assetAudit(asset);
      asset.active = false; asset.version += 1; asset.updatedBy = actor.userId ?? actor.username;
      await manager.save(EquipmentAsset, asset);
      await this.audit(manager, actor, "equipment-register", asset.id, "equipment.asset.disabled", before, this.assetAudit(asset));
      return { id: asset.id, active: false, version: asset.version };
    });
  }

  async createStatus(input: StatusInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "create");
    return this.dataSource.transaction((manager) => this.saveStatus(manager, null, input, actor));
  }

  async updateStatus(id: string, input: StatusInput & { expectedVersion?: number }, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "update");
    return this.dataSource.transaction((manager) => this.saveStatus(manager, id, input, actor));
  }

  async disableStatus(id: string, expectedVersion: number, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "delete");
    return this.dataSource.transaction(async (manager) => {
      const report = await manager.createQueryBuilder(EquipmentStatusReport, "report").setLock("pessimistic_write")
        .where("report.id=:id AND report.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
      if (!report) throw new NotFoundException("设备状态记录不存在");
      this.assertDivision(actor, "equipment-status-report", "delete", report.divisionOrganizationUnitId);
      if (report.version !== Number(expectedVersion)) throw new ConflictException("状态记录已被其他人修改，请刷新后重试");
      const before = this.statusAudit(report);
      report.active = false; report.version += 1; report.updatedBy = actor.userId ?? actor.username;
      await manager.save(EquipmentStatusReport, report);
      await this.audit(manager, actor, "equipment-status-report", report.id, "equipment.status.disabled", before, this.statusAudit(report));
      return { id: report.id, active: false, version: report.version };
    });
  }

  async previewStatusImport(rows: EquipmentStatusImportSourceRow[], actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "import");
    const assets = await this.dataSource.manager.find(EquipmentAsset, { where: { tenantId: actor.tenantId, active: true, monitored: true } });
    const scope = equipmentScope(actor, "equipment-status-report", "import");
    const accessibleAssets = scope.unrestricted ? assets : assets.filter((asset) => scope.divisionIds.includes(asset.divisionOrganizationUnitId));
    const assetsByBusinessKey = new Map<string, EquipmentAsset[]>();
    for (const asset of accessibleAssets) {
      const key = `${asset.divisionNameSnapshot.trim()}\u0000${asset.equipmentCode.trim().toLocaleUpperCase()}`;
      assetsByBusinessKey.set(key, [...(assetsByBusinessKey.get(key) ?? []), asset]);
    }
    const faultReasons = new Set((await this.dataSource.manager.createQueryBuilder(DictionaryValue, "value")
      .innerJoin(DictionaryType, "type", "type.id=value.typeId")
      .where("type.code=:code AND value.enabled=true", { code: "equipmentFaultReason" }).getMany()).map((item) => item.value));
    const errors: Array<{ rowNumber: number; message: string }> = [];
    const validRows: EquipmentStatusImportRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      try {
        const reportDate = this.reportDate(row.reportDate);
        const runtimeMinutes = this.minutes(row.runtimeMinutes, "运行时长"); const faultMinutes = this.minutes(row.faultMinutes, "故障时长");
        const faultReason = String(row.faultReason ?? "").trim() || null;
        if (faultMinutes > 0 && !faultReason) throw new BadRequestException("故障时长大于 0 时必须填写故障原因");
        if (faultReason && !faultReasons.has(faultReason)) throw new BadRequestException("故障原因不在有效选项中");
        const key = `${row.divisionName.trim()}\u0000${row.equipmentCode.trim().toLocaleUpperCase()}`;
        const matches = assetsByBusinessKey.get(key) ?? [];
        if (!matches.length) throw new BadRequestException("未找到当前权限范围内匹配的监控设备");
        if (matches.length > 1) throw new BadRequestException("事业部和设备编号匹配到多台设备，无法自动判断");
        const asset = matches[0]!; const businessKey = `${asset.id}\u0000${reportDate}`;
        if (seen.has(businessKey)) throw new BadRequestException("文件内存在相同设备、相同日期的重复记录");
        seen.add(businessKey);
        const existing = await this.dataSource.manager.findOneBy(EquipmentStatusReport, { tenantId: actor.tenantId, equipmentId: asset.id, reportDate });
        const unchanged = Boolean(existing?.active && existing.runtimeMinutes === runtimeMinutes && existing.faultMinutes === faultMinutes && existing.faultReason === faultReason);
        validRows.push({ ...row, equipmentId: asset.id, equipmentName: asset.equipmentName, reportDate, runtimeMinutes, faultMinutes, faultReason, action: unchanged ? "UNCHANGED" : existing ? "UPDATE" : "CREATE" });
      } catch (error) {
        errors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : "数据无效" });
      }
    }
    return {
      rows: validRows, errors, total: rows.length,
      createCount: validRows.filter((row) => row.action === "CREATE").length,
      updateCount: validRows.filter((row) => row.action === "UPDATE").length,
      unchangedCount: validRows.filter((row) => row.action === "UNCHANGED").length
    };
  }

  async confirmStatusImport(rows: EquipmentStatusImportRow[], fileHash: string, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "import");
    if (!/^[0-9a-f]{64}$/i.test(fileHash)) throw new BadRequestException("导入文件标识无效");
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException("没有可导入的数据");
    const idempotencyKey = `equipment-status-import:${actor.tenantId}:${fileHash}`;
    const requestHash = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    return this.dataSource.transaction(async (manager) => {
      const previous = await manager.findOneBy(IdempotencyRecord, { key: idempotencyKey });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ConflictException("相同文件标识对应的数据不一致");
        return { ...(previous.responseJson as Record<string, unknown>), repeated: true };
      }
      let created = 0; let updated = 0; let unchanged = 0;
      for (const row of rows) {
        const asset = await manager.findOneBy(EquipmentAsset, { id: String(row.equipmentId), tenantId: actor.tenantId, active: true, monitored: true });
        if (!asset) throw new BadRequestException(`第 ${row.rowNumber} 行设备不存在、已停用或无需监控`);
        this.assertDivision(actor, "equipment-status-report", "import", asset.divisionOrganizationUnitId);
        if (asset.divisionNameSnapshot !== row.divisionName.trim() || asset.equipmentCode.toLocaleUpperCase() !== row.equipmentCode.trim().toLocaleUpperCase()) throw new BadRequestException(`第 ${row.rowNumber} 行设备信息已变化，请重新预览`);
        const existing = await manager.createQueryBuilder(EquipmentStatusReport, "report").setLock("pessimistic_write")
          .where("report.tenantId=:tenantId AND report.equipmentId=:equipmentId AND report.reportDate=:reportDate", { tenantId: actor.tenantId, equipmentId: asset.id, reportDate: row.reportDate }).getOne();
        const faultReason = String(row.faultReason ?? "").trim() || null;
        if (existing?.active && existing.runtimeMinutes === Number(row.runtimeMinutes) && existing.faultMinutes === Number(row.faultMinutes) && existing.faultReason === faultReason) { unchanged += 1; continue; }
        await this.saveStatus(manager, existing?.id ?? null, {
          equipmentId: asset.id, reportDate: row.reportDate, runtimeMinutes: row.runtimeMinutes,
          faultMinutes: row.faultMinutes, faultReason, expectedVersion: existing?.version
        }, actor, "import");
        if (existing) updated += 1; else created += 1;
      }
      const result = { total: rows.length, created, updated, unchanged, repeated: false };
      await this.audit(manager, actor, "equipment-status-report", null, "equipment.status.imported", null, { fileHash, ...result });
      await manager.save(IdempotencyRecord, { key: idempotencyKey, requestHash, responseJson: result, createdBy: actor.userId, updatedBy: actor.userId ?? actor.username, version: 1 });
      return result;
    });
  }

  async recordStatusExport(rowCount: number, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "export");
    return this.dataSource.transaction((manager) => this.audit(manager, actor, "equipment-status-report", null, "equipment.status.exported", null, { rowCount }));
  }

  async importWorkbookRows(rows: Array<AssetInput & { sourceSheetRow: number }>, actor: EquipmentActor) {
    this.assert(actor, "equipment-register", "import");
    return this.dataSource.transaction(async (manager) => {
      let created = 0; let updated = 0; let unchanged = 0;
      for (const row of rows) {
        const existing = await manager.findOneBy(EquipmentAsset, {
          tenantId: actor.tenantId, divisionOrganizationUnitId: row.divisionId, equipmentCode: row.equipmentCode
        });
        if (!existing) {
          await this.saveAsset(manager, null, row, actor, row.sourceSheetRow, false); created += 1; continue;
        }
        const changed = existing.equipmentName !== row.equipmentName
          || existing.purchaseDate !== (row.purchaseDate ?? null)
          || existing.usageDepartmentOrganizationUnitId !== (row.usageDepartmentId ?? null)
          || existing.usageDepartmentNameSnapshot !== String(row.usageDepartmentName ?? "").trim()
          || existing.monitored !== Boolean(row.monitored)
          || (!existing.createdBy && Boolean(actor.userId));
        if (!changed) { unchanged += 1; continue; }
        await this.saveAsset(manager, existing.id, { ...row, expectedVersion: existing.version } as AssetInput & { expectedVersion: number }, actor, row.sourceSheetRow, false);
        updated += 1;
      }
      await this.audit(manager, actor, "equipment-register", null, "equipment.workbook.imported", null, { rows: rows.length, created, updated, unchanged });
      return { rows: rows.length, created, updated, unchanged };
    });
  }

  private async saveAsset(manager: EntityManager, id: string | null, input: AssetInput & { expectedVersion?: number }, actor: EquipmentActor, sourceSheetRow: number | null = null, audit = true) {
    const divisionId = String(input.divisionId ?? "").trim();
    const code = String(input.equipmentCode ?? "").trim(); const name = String(input.equipmentName ?? "").trim();
    if (!divisionId || !code || !name) throw new BadRequestException("事业部、设备编号和设备名称不能为空");
    if (code.length > 100 || name.length > 200) throw new BadRequestException("设备编号或名称过长");
    const division = await manager.findOneBy(OrganizationUnit, { id: divisionId, enabled: true });
    if (!division) throw new BadRequestException("事业部不存在或已停用");
    this.assertDivision(actor, "equipment-register", id ? "update" : "create", division.id);
    const usageDepartmentId = input.usageDepartmentId ? String(input.usageDepartmentId) : null;
    const usageDepartment = usageDepartmentId ? await manager.findOneBy(OrganizationUnit, { id: usageDepartmentId, enabled: true }) : null;
    if (usageDepartmentId && !usageDepartment) throw new BadRequestException("使用部门不存在或已停用");
    const purchaseDate = this.optionalDate(input.purchaseDate, "购买日期");
    const responsibleUserIds = [...new Set((input.responsibleUserIds ?? []).map(String).filter(Boolean))];
    if (responsibleUserIds.length) {
      const count = await manager.count(User, { where: { id: In(responsibleUserIds), enabled: true } });
      if (count !== responsibleUserIds.length) throw new BadRequestException("责任人中包含不存在或已停用的成员");
    }
    let asset: EquipmentAsset; let before: unknown = null;
    if (id) {
      const current = await manager.createQueryBuilder(EquipmentAsset, "asset").setLock("pessimistic_write")
        .where("asset.id=:id AND asset.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
      if (!current) throw new NotFoundException("设备不存在");
      this.assertDivision(actor, "equipment-register", "update", current.divisionOrganizationUnitId);
      if (current.version !== Number(input.expectedVersion)) throw new ConflictException("设备已被其他人修改，请刷新后重试");
      before = this.assetAudit(current); asset = current; asset.version += 1;
    } else {
      asset = manager.create(EquipmentAsset, { tenantId: actor.tenantId, active: true, createdBy: actor.userId, version: 1 });
    }
    asset.divisionOrganizationUnitId = division.id; asset.divisionNameSnapshot = division.name;
    asset.usageDepartmentOrganizationUnitId = usageDepartment?.id ?? null;
    asset.usageDepartmentNameSnapshot = String(input.usageDepartmentName ?? usageDepartment?.name ?? "").trim();
    asset.equipmentCode = code; asset.equipmentName = name; asset.purchaseDate = purchaseDate;
    asset.monitored = input.monitored === undefined ? true : Boolean(input.monitored); asset.active = true;
    if (!asset.createdBy && actor.userId) asset.createdBy = actor.userId;
    asset.sourceSheetRow = sourceSheetRow ?? asset.sourceSheetRow ?? null; asset.updatedBy = actor.userId ?? actor.username;
    try { asset = await manager.save(EquipmentAsset, asset); }
    catch (error: any) { if (String(error?.code) === "23505") throw new ConflictException("该事业部已经存在相同设备编号"); throw error; }
    if (input.responsibleUserIds !== undefined) {
      await manager.delete(EquipmentResponsible, { tenantId: actor.tenantId, equipmentId: asset.id });
      for (const userId of responsibleUserIds) await manager.save(EquipmentResponsible, {
        tenantId: actor.tenantId, equipmentId: asset.id, userId, createdBy: actor.userId,
        updatedBy: actor.userId ?? actor.username, version: 1
      });
    }
    if (audit) await this.audit(manager, actor, "equipment-register", asset.id, id ? "equipment.asset.updated" : "equipment.asset.created", before, this.assetAudit(asset));
    return { id: asset.id, version: asset.version };
  }

  private async saveStatus(manager: EntityManager, id: string | null, input: StatusInput & { expectedVersion?: number }, actor: EquipmentActor, permissionAction?: "create" | "update" | "import") {
    const equipmentId = String(input.equipmentId ?? "").trim();
    const asset = await manager.findOneBy(EquipmentAsset, { id: equipmentId, tenantId: actor.tenantId, active: true });
    if (!asset || !asset.monitored) throw new BadRequestException("设备不存在、已停用或不需要监控");
    this.assertDivision(actor, "equipment-status-report", permissionAction ?? (id ? "update" : "create"), asset.divisionOrganizationUnitId);
    const reportDate = this.reportDate(input.reportDate);
    const runtimeMinutes = this.minutes(input.runtimeMinutes, "运行时长"); const faultMinutes = this.minutes(input.faultMinutes, "故障时长");
    const faultReason = String(input.faultReason ?? "").trim() || null;
    if (faultMinutes > 0 && !faultReason) throw new BadRequestException("故障时长大于 0 时必须选择故障原因");
    if (faultReason) {
      const valid = await manager.createQueryBuilder(DictionaryValue, "value").innerJoin(DictionaryType, "type", "type.id=value.typeId")
        .where("type.code=:code AND value.value=:value AND value.enabled=true", { code: "equipmentFaultReason", value: faultReason }).getOne();
      if (!valid) throw new BadRequestException("故障原因不在有效选项中");
    }
    let report: EquipmentStatusReport; let before: unknown = null;
    if (id) {
      const current = await manager.createQueryBuilder(EquipmentStatusReport, "report").setLock("pessimistic_write")
        .where("report.id=:id AND report.tenantId=:tenantId", { id, tenantId: actor.tenantId }).getOne();
      if (!current) throw new NotFoundException("设备状态记录不存在");
      this.assertDivision(actor, "equipment-status-report", permissionAction ?? "update", current.divisionOrganizationUnitId);
      if (current.version !== Number(input.expectedVersion)) throw new ConflictException("状态记录已被其他人修改，请刷新后重试");
      before = this.statusAudit(current); report = current; report.version += 1;
    } else report = manager.create(EquipmentStatusReport, { tenantId: actor.tenantId, createdBy: actor.userId, version: 1 });
    Object.assign(report, {
      equipmentId: asset.id, divisionOrganizationUnitId: asset.divisionOrganizationUnitId,
      usageDepartmentOrganizationUnitId: asset.usageDepartmentOrganizationUnitId,
      equipmentCodeSnapshot: asset.equipmentCode, equipmentNameSnapshot: asset.equipmentName,
      divisionNameSnapshot: asset.divisionNameSnapshot, usageDepartmentNameSnapshot: asset.usageDepartmentNameSnapshot,
      reportDate, runtimeMinutes, faultMinutes, faultReason, active: true, updatedBy: actor.userId ?? actor.username
    });
    try { report = await manager.save(EquipmentStatusReport, report); }
    catch (error: any) { if (String(error?.code) === "23505") throw new ConflictException("该设备在所选日期已经填报，请编辑已有记录"); throw error; }
    await this.audit(manager, actor, "equipment-status-report", report.id, id ? "equipment.status.updated" : "equipment.status.created", before, this.statusAudit(report));
    return { id: report.id, version: report.version };
  }

  private assert(actor: EquipmentActor, resource: string, action: string) {
    if (!hasEquipmentPermission(actor, resource, action)) throw new ForbiddenException("当前权限组没有此表的操作权限");
  }

  private assertDivision(actor: EquipmentActor, resource: string, action: string, divisionId: string) {
    const scope = equipmentScope(actor, resource, action);
    if (!scope.unrestricted && !scope.divisionIds.includes(divisionId)) throw new ForbiddenException("超出事业部数据范围");
  }

  private optionalDate(value: unknown, label: string) {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new BadRequestException(`${label}格式无效`);
    return text;
  }

  private reportDate(value: unknown) {
    const text = this.optionalDate(value, "填报日期"); if (!text) throw new BadRequestException("填报日期不能为空");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const minimum = new Date(`${today}T00:00:00+08:00`); minimum.setDate(minimum.getDate() - 6);
    const minText = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(minimum);
    if (text > today || text < minText) throw new BadRequestException(`填报日期只能选择 ${minText} 至 ${today}`);
    return text;
  }

  private minutes(value: unknown, label: string) {
    const number = Number(value ?? 0); if (!Number.isInteger(number) || number < 0) throw new BadRequestException(`${label}必须是非负整数分钟`); return number;
  }

  private assetAudit(asset: EquipmentAsset) { return { divisionId: asset.divisionOrganizationUnitId, usageDepartmentId: asset.usageDepartmentOrganizationUnitId, equipmentCode: asset.equipmentCode, equipmentName: asset.equipmentName, purchaseDate: asset.purchaseDate, monitored: asset.monitored, active: asset.active, version: asset.version }; }
  private statusAudit(report: EquipmentStatusReport) { return { equipmentId: report.equipmentId, reportDate: report.reportDate, runtimeMinutes: report.runtimeMinutes, faultMinutes: report.faultMinutes, faultReason: report.faultReason, active: report.active, version: report.version }; }
  private audit(manager: EntityManager, actor: EquipmentActor, resource: string, recordId: string | null, action: string, beforeJson: unknown, afterJson: unknown) {
    return manager.save(AuditLog, { actorId: actor.userId, actorName: actor.username, resource, recordId, action, beforeJson, afterJson, requestId: actor.requestId, source: actor.source ?? "web", updatedBy: actor.userId ?? actor.username });
  }
}
