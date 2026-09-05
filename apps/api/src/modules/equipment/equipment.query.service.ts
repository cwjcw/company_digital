import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { EquipmentActor, equipmentScope, hasEquipmentPermission } from "./equipment.types";

type PageInput = {
  page?: number; pageSize?: number; search?: string; divisionId?: string; equipmentId?: string;
  divisionName?: string; usageDepartmentName?: string; equipmentCode?: string; equipmentName?: string;
  reportDate?: string; runtimeMinutes?: string; faultMinutes?: string; faultReason?: string; responsibleUserIds?: string;
  createdBy?: string; createdAt?: string; updatedBy?: string; updatedAt?: string;
  sortField?: string; sortOrder?: string;
};
type DashboardInput = { periodType?: string; period?: string; startDate?: string; endDate?: string; divisionId?: string; departmentId?: string | string[] };

@Injectable()
export class EquipmentQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async listAssets(input: PageInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-register", "read");
    const { page, pageSize, offset } = this.page(input); const params: unknown[] = [actor.tenantId];
    const clauses = ["asset.tenant_id=$1", "asset.active=true", this.scopeClause(actor, "equipment-register", "read", "asset", params)];
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(asset.equipment_code ILIKE $${params.length} OR asset.equipment_name ILIKE $${params.length} OR asset.division_name_snapshot ILIKE $${params.length} OR asset.usage_department_name_snapshot ILIKE $${params.length})`); }
    if (input.divisionId) { params.push(input.divisionId); clauses.push(`asset.division_organization_unit_id=$${params.length}::uuid`); }
    this.textFilters(input, params, clauses, {
      divisionName: "asset.division_name_snapshot", usageDepartmentName: "asset.usage_department_name_snapshot",
      equipmentCode: "asset.equipment_code", equipmentName: "asset.equipment_name",
      createdBy: "asset.created_by::text", createdAt: "asset.created_at::text", updatedBy: "asset.updated_by::text", updatedAt: "asset.updated_at::text"
    });
    const where = clauses.join(" AND ");
    const sortColumns: Record<string, string> = { divisionName:"asset.division_name_snapshot",usageDepartmentName:"asset.usage_department_name_snapshot",equipmentCode:"asset.equipment_code",equipmentName:"asset.equipment_name",purchaseDate:"asset.purchase_date",monitored:"asset.monitored",createdBy:"asset.created_by",createdAt:"asset.created_at",updatedBy:"asset.updated_by",updatedAt:"asset.updated_at" };
    const sortColumn = sortColumns[input.sortField ?? ""];
    const orderBy = sortColumn ? `${sortColumn} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST` : "asset.division_name_snapshot,asset.usage_department_name_snapshot,asset.equipment_code";
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM equipment_assets asset WHERE ${where}`, params);
    params.push(pageSize, offset);
    const rows = await this.dataSource.query(`
      SELECT asset.id,asset.division_organization_unit_id "divisionId",asset.division_name_snapshot "divisionName",
        asset.usage_department_organization_unit_id "usageDepartmentId",asset.usage_department_name_snapshot "usageDepartmentName",
        asset.equipment_code "equipmentCode",asset.equipment_name "equipmentName",asset.purchase_date "purchaseDate",
        asset.monitored,asset.active,asset.version,asset.created_by "createdBy",asset.created_at "createdAt",
        asset.updated_by "updatedBy",asset.updated_at "updatedAt",
        COALESCE(resp.ids,'[]'::jsonb) "responsibleUserIds",COALESCE(resp.users,'[]'::jsonb) "responsibleUsers"
      FROM equipment_assets asset
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(u.id ORDER BY u.display_name) ids,
          jsonb_agg(jsonb_build_object('id',u.id,'displayName',u.display_name,'enabled',u.enabled) ORDER BY u.display_name) users
        FROM equipment_responsibles er JOIN users u ON u.id=er.user_id
        WHERE er.tenant_id=asset.tenant_id AND er.equipment_id=asset.id
      ) resp ON true
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { rows, total: Number(count), page, pageSize };
  }

  async listStatus(input: PageInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "read");
    const { page, pageSize, offset } = this.page(input); const params: unknown[] = [actor.tenantId];
    const clauses = ["report.tenant_id=$1", "report.active=true", this.scopeClause(actor, "equipment-status-report", "read", "report", params)];
    const responsibleNames = `COALESCE((SELECT string_agg(u.display_name,' ') FROM equipment_responsibles er JOIN users u ON u.id=er.user_id WHERE er.tenant_id=report.tenant_id AND er.equipment_id=report.equipment_id),'')`;
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(report.equipment_code_snapshot ILIKE $${params.length} OR report.equipment_name_snapshot ILIKE $${params.length} OR report.division_name_snapshot ILIKE $${params.length} OR report.usage_department_name_snapshot ILIKE $${params.length} OR COALESCE(report.fault_reason,'') ILIKE $${params.length} OR ${responsibleNames} ILIKE $${params.length})`); }
    if (input.divisionId) { params.push(input.divisionId); clauses.push(`report.division_organization_unit_id=$${params.length}::uuid`); }
    if (input.equipmentId) { params.push(input.equipmentId); clauses.push(`report.equipment_id=$${params.length}::uuid`); }
    this.textFilters(input, params, clauses, {
      divisionName: "report.division_name_snapshot", usageDepartmentName: "report.usage_department_name_snapshot",
      equipmentCode: "report.equipment_code_snapshot", equipmentName: "report.equipment_name_snapshot", reportDate: "report.report_date::text",
      runtimeMinutes: "report.runtime_minutes::text", faultMinutes: "report.fault_minutes::text", faultReason: "COALESCE(report.fault_reason,'')", responsibleUserIds: responsibleNames,
      createdBy: "report.created_by::text", createdAt: "report.created_at::text", updatedBy: "report.updated_by::text", updatedAt: "report.updated_at::text"
    });
    const where = clauses.join(" AND ");
    const sortColumns: Record<string, string> = { equipmentCode:"report.equipment_code_snapshot",equipmentName:"report.equipment_name_snapshot",divisionName:"report.division_name_snapshot",usageDepartmentName:"report.usage_department_name_snapshot",responsibleUserIds:responsibleNames,reportDate:"report.report_date",runtimeMinutes:"report.runtime_minutes",faultMinutes:"report.fault_minutes",faultReason:"report.fault_reason",createdBy:"report.created_by",createdAt:"report.created_at",updatedBy:"report.updated_by",updatedAt:"report.updated_at" };
    const sortColumn = sortColumns[input.sortField ?? ""];
    const orderBy = sortColumn ? `${sortColumn} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST` : "report.report_date DESC,report.division_name_snapshot,report.equipment_code_snapshot";
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM equipment_status_reports report WHERE ${where}`, params);
    params.push(pageSize, offset);
    const rows = await this.dataSource.query(`
      SELECT report.id,report.equipment_id "equipmentId",report.equipment_code_snapshot "equipmentCode",
        report.equipment_name_snapshot "equipmentName",report.division_organization_unit_id "divisionId",
        report.division_name_snapshot "divisionName",report.usage_department_organization_unit_id "usageDepartmentId",
        report.usage_department_name_snapshot "usageDepartmentName",report.report_date "reportDate",
        report.runtime_minutes "runtimeMinutes",report.fault_minutes "faultMinutes",report.fault_reason "faultReason",
        report.version,report.created_by "createdBy",report.created_at "createdAt",report.updated_by "updatedBy",report.updated_at "updatedAt",
        COALESCE(resp.ids,'[]'::jsonb) "responsibleUserIds",COALESCE(resp.users,'[]'::jsonb) "responsibleUsers"
      FROM equipment_status_reports report
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(u.id ORDER BY u.display_name) ids,
          jsonb_agg(jsonb_build_object('id',u.id,'displayName',u.display_name,'enabled',u.enabled) ORDER BY u.display_name) users
        FROM equipment_responsibles er JOIN users u ON u.id=er.user_id
        WHERE er.tenant_id=report.tenant_id AND er.equipment_id=report.equipment_id
      ) resp ON true
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { rows, total: Number(count), page, pageSize };
  }

  async exportStatus(input: PageInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-status-report", "export");
    const params: unknown[] = [actor.tenantId];
    const clauses = ["report.tenant_id=$1", "report.active=true", this.scopeClause(actor, "equipment-status-report", "export", "report", params)];
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(report.equipment_code_snapshot ILIKE $${params.length} OR report.equipment_name_snapshot ILIKE $${params.length} OR report.division_name_snapshot ILIKE $${params.length} OR report.usage_department_name_snapshot ILIKE $${params.length} OR COALESCE(report.fault_reason,'') ILIKE $${params.length})`); }
    this.textFilters(input, params, clauses, {
      divisionName: "report.division_name_snapshot", usageDepartmentName: "report.usage_department_name_snapshot",
      equipmentCode: "report.equipment_code_snapshot", equipmentName: "report.equipment_name_snapshot", reportDate: "report.report_date::text",
      runtimeMinutes: "report.runtime_minutes::text", faultMinutes: "report.fault_minutes::text", faultReason: "COALESCE(report.fault_reason,'')"
    });
    return this.dataSource.query(`SELECT report.division_name_snapshot "divisionName",report.equipment_code_snapshot "equipmentCode",
      report.equipment_name_snapshot "equipmentName",report.usage_department_name_snapshot "usageDepartmentName",report.report_date "reportDate",
      report.runtime_minutes "runtimeMinutes",report.fault_minutes "faultMinutes",report.fault_reason "faultReason"
      FROM equipment_status_reports report WHERE ${clauses.join(" AND ")}
      ORDER BY report.report_date DESC,report.division_name_snapshot,report.equipment_code_snapshot`, params);
  }

  async formOptions(actor: EquipmentActor) {
    if (!["equipment-register", "equipment-status-report"].some((resource) => ["read", "create", "update"].some((action) => hasEquipmentPermission(actor, resource, action)))) throw new ForbiddenException("没有设备管理权限");
    const resource = hasEquipmentPermission(actor, "equipment-status-report", "create") || hasEquipmentPermission(actor, "equipment-status-report", "read") ? "equipment-status-report" : "equipment-register";
    const action = hasEquipmentPermission(actor, resource, "create") ? "create" : "read";
    const params: unknown[] = [actor.tenantId]; const scope = this.scopeClause(actor, resource, action, "asset", params);
    const [equipment, users, organizations, faultReasons] = await Promise.all([
      this.dataSource.query(`SELECT asset.id,asset.equipment_code "equipmentCode",asset.equipment_name "equipmentName",asset.division_organization_unit_id "divisionId",asset.division_name_snapshot "divisionName",asset.usage_department_organization_unit_id "usageDepartmentId",asset.usage_department_name_snapshot "usageDepartmentName" FROM equipment_assets asset WHERE asset.tenant_id=$1 AND asset.active=true AND asset.monitored=true AND ${scope} ORDER BY asset.equipment_code,asset.division_name_snapshot`, params),
      this.dataSource.query(`SELECT id,display_name "displayName",enabled FROM users WHERE enabled=true ORDER BY display_name`),
      this.organizationOptions(),
      this.dataSource.query(`SELECT dv.value FROM dictionary_values dv JOIN dictionary_types dt ON dt.id=dv.type_id WHERE dt.code='equipmentFaultReason' AND dv.enabled=true ORDER BY dv.sort_order,dv.value`)
    ]);
    return { equipment, users, organizations, faultReasons: faultReasons.map((row: any) => row.value) };
  }

  async governanceSummary(actor: EquipmentActor) {
    this.assert(actor, "equipment-dashboard", "read");
    const params: unknown[] = [actor.tenantId];
    const scope = this.scopeClause(actor, "equipment-dashboard", "read", "asset", params);
    const rows = await this.dataSource.query(`
      SELECT asset.division_organization_unit_id "divisionId",
        asset.division_name_snapshot "divisionName",
        count(*)::integer "totalEquipment",
        count(*) FILTER (WHERE asset.monitored=true)::integer "monitoredEquipment",
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM equipment_responsibles responsible
          WHERE responsible.tenant_id=asset.tenant_id AND responsible.equipment_id=asset.id
        ))::integer "responsibleEquipment"
      FROM equipment_assets asset
      WHERE asset.tenant_id=$1 AND asset.active=true AND ${scope}
      GROUP BY asset.division_organization_unit_id,asset.division_name_snapshot
      ORDER BY asset.division_name_snapshot
    `, params);
    return {
      generatedAt: new Date().toISOString(),
      rows: rows.map((row: Record<string, unknown>) => ({
        ...row,
        totalEquipment: Number(row.totalEquipment ?? 0),
        monitoredEquipment: Number(row.monitoredEquipment ?? 0),
        responsibleEquipment: Number(row.responsibleEquipment ?? 0)
      }))
    };
  }

  async dashboard(input: DashboardInput, actor: EquipmentActor) {
    this.assert(actor, "equipment-dashboard", "read");
    const dashboardInput = this.dashboardInput(input);
    const params: unknown[] = [actor.tenantId]; const scope = this.scopeClause(actor, "equipment-dashboard", "read", "asset", params);
    params.push(dashboardInput.windowStart, dashboardInput.windowEnd, dashboardInput.windowDays);
    const [windowStartParam, windowEndParam, windowDaysParam] = [params.length - 2, params.length - 1, params.length];
    const scopedFilters = ["asset.tenant_id=$1", "asset.active=true", scope];
    const eligibleFilters: string[] = [];
    const departmentOptionFilters: string[] = [];
    if (dashboardInput.divisionId) {
      params.push(dashboardInput.divisionId);
      eligibleFilters.push(`asset.division_organization_unit_id=$${params.length}::uuid`);
      departmentOptionFilters.push(`asset.division_organization_unit_id=$${params.length}::uuid`);
    }
    if (dashboardInput.departmentIds.length) {
      params.push(dashboardInput.departmentIds);
      eligibleFilters.push(`asset.usage_department_organization_unit_id=ANY($${params.length}::uuid[])`);
    }
    const [payload] = await this.dataSource.query(`
      WITH bounds AS (
        SELECT $${windowStartParam}::date window_start,$${windowEndParam}::date window_end,$${windowDaysParam}::integer window_days
      ), scoped_assets AS MATERIALIZED (
        SELECT asset.* FROM equipment_assets asset WHERE ${scopedFilters.join(" AND ")}
      ), eligible AS MATERIALIZED (
        SELECT asset.* FROM scoped_assets asset${eligibleFilters.length ? ` WHERE ${eligibleFilters.join(" AND ")}` : ""}
      ), monitored AS MATERIALIZED (
        SELECT * FROM eligible WHERE monitored=true
      ), window_reports AS MATERIALIZED (
        SELECT report.* FROM equipment_status_reports report JOIN monitored asset ON asset.id=report.equipment_id CROSS JOIN bounds
        WHERE report.tenant_id=$1 AND report.active=true AND report.report_date BETWEEN bounds.window_start AND bounds.window_end
      ), latest AS MATERIALIZED (
        SELECT DISTINCT ON (report.equipment_id) report.* FROM window_reports report ORDER BY report.equipment_id,report.report_date DESC,report.updated_at DESC
      ), asset_state AS (
        SELECT asset.id,asset.division_organization_unit_id division_id,asset.division_name_snapshot division,
          asset.usage_department_organization_unit_id department_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门') department,
          CASE WHEN latest.id IS NULL THEN '未填报' WHEN latest.fault_minutes>0 THEN '存在故障' WHEN latest.runtime_minutes>0 THEN '正常运行' ELSE '未运行' END state
        FROM monitored asset LEFT JOIN latest ON latest.equipment_id=asset.id
      ), division_state AS (
        SELECT division_id,division,count(*)::integer equipment_count,
          count(*) FILTER (WHERE state='正常运行')::integer normal_count,
          count(*) FILTER (WHERE state='存在故障')::integer fault_count,
          count(*) FILTER (WHERE state='未运行')::integer idle_count,
          count(*) FILTER (WHERE state='未填报')::integer unreported_count
        FROM asset_state GROUP BY division_id,division
      ), division_duration AS (
        SELECT asset.division_organization_unit_id division_id,asset.division_name_snapshot division,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,COALESCE(sum(report.fault_minutes),0)::integer fault_minutes
        FROM monitored asset LEFT JOIN window_reports report ON report.equipment_id=asset.id
        GROUP BY asset.division_organization_unit_id,asset.division_name_snapshot
      ), division_analysis AS (
        SELECT state.division,state.equipment_count,state.normal_count,state.fault_count,state.idle_count,state.unreported_count,
          duration.runtime_minutes,duration.fault_minutes,
          round(duration.runtime_minutes::numeric/(SELECT window_days FROM bounds),2) runtime_daily_average_minutes,
          round(duration.fault_minutes::numeric/(SELECT window_days FROM bounds),2) fault_daily_average_minutes
        FROM division_state state JOIN division_duration duration ON duration.division_id=state.division_id
      ), department_state AS (
        SELECT department_id,department,count(*)::integer equipment_count,
          count(*) FILTER (WHERE state='正常运行')::integer normal_count,
          count(*) FILTER (WHERE state='存在故障')::integer fault_count,
          count(*) FILTER (WHERE state='未运行')::integer idle_count,
          count(*) FILTER (WHERE state='未填报')::integer unreported_count
        FROM asset_state GROUP BY department_id,department
      ), department_duration AS (
        SELECT asset.usage_department_organization_unit_id department_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门') department,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,COALESCE(sum(report.fault_minutes),0)::integer fault_minutes
        FROM monitored asset LEFT JOIN window_reports report ON report.equipment_id=asset.id
        GROUP BY asset.usage_department_organization_unit_id,COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门')
      ), department_analysis AS (
        SELECT state.department_id,state.department,state.equipment_count,state.normal_count,state.fault_count,state.idle_count,state.unreported_count,
          duration.runtime_minutes,duration.fault_minutes,
          round(duration.runtime_minutes::numeric/(SELECT window_days FROM bounds),2) runtime_daily_average_minutes,
          round(duration.fault_minutes::numeric/(SELECT window_days FROM bounds),2) fault_daily_average_minutes
        FROM department_state state JOIN department_duration duration
          ON duration.department_id IS NOT DISTINCT FROM state.department_id AND duration.department=state.department
      )
      SELECT jsonb_build_object(
        'windowStart',(SELECT window_start FROM bounds),'windowEnd',(SELECT window_end FROM bounds),'windowDays',(SELECT window_days FROM bounds),
        'metrics',jsonb_build_object(
          'totalEquipment',(SELECT count(*) FROM eligible),'monitoredEquipment',(SELECT count(*) FROM monitored),
          'runtimeMinutes',(SELECT COALESCE(sum(runtime_minutes),0) FROM window_reports),'faultMinutes',(SELECT COALESCE(sum(fault_minutes),0) FROM window_reports),
          'runtimeDailyAverageMinutes',round((SELECT COALESCE(sum(runtime_minutes),0) FROM window_reports)::numeric/(SELECT window_days FROM bounds),2),
          'faultDailyAverageMinutes',round((SELECT COALESCE(sum(fault_minutes),0) FROM window_reports)::numeric/(SELECT window_days FROM bounds),2),
          'normalEquipment',(SELECT count(*) FROM asset_state WHERE state='正常运行'),'faultEquipment',(SELECT count(*) FROM asset_state WHERE state='存在故障'),
          'idleEquipment',(SELECT count(*) FROM asset_state WHERE state='未运行')
        ),
        'divisionRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'division',division,'equipmentCount',equipment_count,'normalCount',normal_count,'faultCount',fault_count,
          'idleCount',idle_count,'unreportedCount',unreported_count,'runtimeMinutes',runtime_minutes,'faultMinutes',fault_minutes,
          'runtimeDailyAverageMinutes',runtime_daily_average_minutes,'faultDailyAverageMinutes',fault_daily_average_minutes
        ) ORDER BY division) FROM division_analysis),'[]'::jsonb),
        'departmentRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'departmentId',department_id,'department',department,'equipmentCount',equipment_count,'normalCount',normal_count,'faultCount',fault_count,
          'idleCount',idle_count,'unreportedCount',unreported_count,'runtimeMinutes',runtime_minutes,'faultMinutes',fault_minutes,
          'runtimeDailyAverageMinutes',runtime_daily_average_minutes,'faultDailyAverageMinutes',fault_daily_average_minutes
        ) ORDER BY department) FROM department_analysis),'[]'::jsonb),
        'filters',jsonb_build_object(
          'divisions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',division_id,'name',division) ORDER BY division)
            FROM (SELECT DISTINCT division_organization_unit_id division_id,division_name_snapshot division FROM scoped_assets) divisions),'[]'::jsonb),
          'departments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',department_id,'name',department) ORDER BY department)
            FROM (SELECT DISTINCT usage_department_organization_unit_id department_id,usage_department_name_snapshot department
              FROM scoped_assets asset WHERE usage_department_organization_unit_id IS NOT NULL${departmentOptionFilters.length ? ` AND ${departmentOptionFilters.join(" AND ")}` : ""}) departments),'[]'::jsonb)
        )
      ) payload
    `, params);
    return payload.payload;
  }

  private dashboardInput(input: DashboardInput) {
    const periodType = input.periodType ?? "month";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    let windowStart: string; let windowEnd: string;
    if (periodType === "month") {
      const period = input.period ?? today.slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new BadRequestException("按月筛选必须提供 YYYY-MM");
      windowStart = `${period}-01`; windowEnd = this.monthEnd(windowStart);
    } else if (periodType === "year") {
      const period = input.period ?? today.slice(0, 4);
      if (!/^\d{4}$/.test(period)) throw new BadRequestException("按年筛选必须提供 YYYY");
      windowStart = `${period}-01-01`; windowEnd = `${period}-12-31`;
    } else if (periodType === "custom") {
      windowStart = this.isoDate(input.startDate, "开始日期"); windowEnd = this.isoDate(input.endDate, "结束日期");
      if (windowEnd < windowStart) throw new BadRequestException("结束日期不能早于开始日期");
      if (windowEnd > this.addMonths(windowStart, 24)) throw new BadRequestException("自定义日期跨度不能超过24个月");
    } else throw new BadRequestException("不支持的统计周期");
    const ensureUuid = (value: string | undefined, label: string) => {
      if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException(`${label}筛选无效`);
      return value;
    };
    const departmentIds = (Array.isArray(input.departmentId) ? input.departmentId : input.departmentId ? [input.departmentId] : [])
      .map((value) => ensureUuid(value, "部门")!);
    return {
      windowStart, windowEnd, windowDays: Math.round((Date.parse(`${windowEnd}T00:00:00Z`) - Date.parse(`${windowStart}T00:00:00Z`)) / 86_400_000) + 1,
      divisionId: ensureUuid(input.divisionId, "事业部"), departmentIds: [...new Set(departmentIds)]
    };
  }

  private isoDate(value: string | undefined, label: string) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label}必须为 YYYY-MM-DD`);
    return value;
  }

  private monthEnd(monthStart: string) {
    const [year, month] = monthStart.split("-").map(Number); return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
  }

  private addMonths(value: string, months: number) {
    const [year, month, day] = value.split("-").map(Number); const targetMonth = month! - 1 + months;
    const targetYear = year! + Math.floor(targetMonth / 12); const targetMonthIndex = targetMonth % 12;
    const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonthIndex, Math.min(day!, lastDay))).toISOString().slice(0, 10);
  }

  private assert(actor: EquipmentActor, resource: string, action: string) {
    if (!hasEquipmentPermission(actor, resource, action)) throw new ForbiddenException("当前权限组没有此表的操作权限");
  }

  private scopeClause(actor: EquipmentActor, resource: string, action: string, alias: string, params: unknown[]) {
    const scope = equipmentScope(actor, resource, action);
    if (scope.unrestricted) return "1=1";
    if (!scope.divisionIds.length) return "1=0";
    params.push(scope.divisionIds); return `${alias}.division_organization_unit_id=ANY($${params.length}::uuid[])`;
  }

  private page(input: PageInput) {
    const page = Math.max(1, Number(input.page ?? 1)); const requested = Number(input.pageSize ?? 50);
    const pageSize = [20, 50, 100, 200].includes(requested) ? requested : 50;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  private textFilters(input: PageInput, params: unknown[], clauses: string[], columns: Record<string, string>) {
    for (const [key, column] of Object.entries(columns)) {
      const value = String(input[key as keyof PageInput] ?? "").trim();
      if (!value) continue;
      params.push(`%${value}%`); clauses.push(`${column} ILIKE $${params.length}`);
    }
  }

  private organizationOptions() {
    return this.dataSource.query(`WITH RECURSIVE org AS (
      SELECT id,name,parent_id,ARRAY[name]::varchar[] path,enabled FROM organization_units WHERE parent_id IS NULL
      UNION ALL SELECT child.id,child.name,child.parent_id,parent.path||child.name,child.enabled FROM organization_units child JOIN org parent ON parent.id=child.parent_id
    ) SELECT id,name,"parent_id" "parentId",path,array_to_string(path,' / ') "pathLabel" FROM org WHERE enabled=true ORDER BY path`);
  }
}
