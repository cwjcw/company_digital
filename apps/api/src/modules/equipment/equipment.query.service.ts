import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import { EquipmentActor, equipmentCreateScopeClause, equipmentScopeClause, hasEquipmentPermission } from "./equipment.types";

type PageInput = {
  page?: number; pageSize?: number; search?: string; divisionId?: string; equipmentId?: string;
  filterGroup?: unknown;
  divisionName?: string; usageDepartmentName?: string; equipmentCode?: string; equipmentName?: string;
  purchaseDate?: string; plannedStartupMinutes?: string; monitored?: string;
  reportDate?: string; runtimeMinutes?: string; faultMinutes?: string; faultReason?: string; responsibleUserIds?: string;
  plannedRuntimeMinutes?: string; utilizationRate?: string;
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
    const responsibleNames = `COALESCE((SELECT string_agg(u.display_name,' ') FROM equipment_responsibles er JOIN users u ON u.id=er.user_id WHERE er.tenant_id=asset.tenant_id AND er.equipment_id=asset.id),'')`;
    const plannedStartupDuration = `(asset.planned_startup_minutes / 60)::text || '小时' || (asset.planned_startup_minutes % 60)::text || '分钟'`;
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(asset.equipment_code ILIKE $${params.length} OR asset.equipment_name ILIKE $${params.length} OR asset.division_name_snapshot ILIKE $${params.length} OR asset.usage_department_name_snapshot ILIKE $${params.length} OR ${plannedStartupDuration} ILIKE $${params.length} OR ${responsibleNames} ILIKE $${params.length})`); }
    if (input.divisionId) { params.push(input.divisionId); clauses.push(`asset.division_organization_unit_id=$${params.length}::uuid`); }
    this.textFilters(input, params, clauses, {
      divisionName: "asset.division_name_snapshot", usageDepartmentName: "asset.usage_department_name_snapshot",
      equipmentCode: "asset.equipment_code", equipmentName: "asset.equipment_name",
      purchaseDate: "asset.purchase_date::text", plannedStartupMinutes: plannedStartupDuration, responsibleUserIds: responsibleNames,
      createdBy: "asset.created_by::text", createdAt: "asset.created_at::text", updatedBy: "asset.updated_by::text", updatedAt: "asset.updated_at::text"
    });
    this.booleanLabelFilter(input.monitored, params, clauses, "asset.monitored", "需要填报", "无需填报");
    await this.typedFilter(input, params, clauses, "asset", "equipment-register", actor);
    const where = clauses.join(" AND ");
    const sortColumns: Record<string, string> = { divisionName:"asset.division_name_snapshot",usageDepartmentName:"asset.usage_department_name_snapshot",equipmentCode:"asset.equipment_code",equipmentName:"asset.equipment_name",purchaseDate:"asset.purchase_date",plannedStartupMinutes:"asset.planned_startup_minutes",monitored:"asset.monitored",createdBy:"asset.created_by",createdAt:"asset.created_at",updatedBy:"asset.updated_by",updatedAt:"asset.updated_at" };
    this.assertSortField(input.sortField, sortColumns, "equipment-register", actor);
    const sortColumn = sortColumns[input.sortField ?? ""];
    const orderBy = sortColumn ? `${sortColumn} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST` : "asset.division_name_snapshot,asset.usage_department_name_snapshot,asset.equipment_code";
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM equipment_assets asset WHERE ${where}`, params);
    params.push(pageSize, offset);
    const rows = await this.dataSource.query(`
      SELECT asset.id,asset.division_organization_unit_id "divisionId",asset.division_name_snapshot "divisionName",
        asset.usage_department_organization_unit_id "usageDepartmentId",asset.usage_department_name_snapshot "usageDepartmentName",
        asset.equipment_code "equipmentCode",asset.equipment_name "equipmentName",asset.purchase_date "purchaseDate",
        asset.planned_startup_minutes "plannedStartupMinutes",
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
    const utilizationRate = `(CASE WHEN report.planned_runtime_minutes IS NULL OR report.planned_runtime_minutes <= 0 THEN NULL ELSE report.runtime_minutes::numeric / report.planned_runtime_minutes * 100 END)`;
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(report.equipment_code_snapshot ILIKE $${params.length} OR report.equipment_name_snapshot ILIKE $${params.length} OR report.division_name_snapshot ILIKE $${params.length} OR report.usage_department_name_snapshot ILIKE $${params.length} OR COALESCE(report.fault_reason,'') ILIKE $${params.length} OR ${responsibleNames} ILIKE $${params.length})`); }
    if (input.divisionId) { params.push(input.divisionId); clauses.push(`report.division_organization_unit_id=$${params.length}::uuid`); }
    if (input.equipmentId) { params.push(input.equipmentId); clauses.push(`report.equipment_id=$${params.length}::uuid`); }
    this.textFilters(input, params, clauses, {
      divisionName: "report.division_name_snapshot", usageDepartmentName: "report.usage_department_name_snapshot",
      equipmentCode: "report.equipment_code_snapshot", equipmentName: "report.equipment_name_snapshot", reportDate: "report.report_date::text",
      plannedRuntimeMinutes: "report.planned_runtime_minutes::text", runtimeMinutes: "report.runtime_minutes::text", utilizationRate: `${utilizationRate}::text`, faultMinutes: "report.fault_minutes::text", faultReason: "COALESCE(report.fault_reason,'')", responsibleUserIds: responsibleNames,
      createdBy: "report.created_by::text", createdAt: "report.created_at::text", updatedBy: "report.updated_by::text", updatedAt: "report.updated_at::text"
    });
    await this.typedFilter(input, params, clauses, "report", "equipment-status-report", actor);
    const where = clauses.join(" AND ");
    const sortColumns: Record<string, string> = { equipmentCode:"report.equipment_code_snapshot",equipmentName:"report.equipment_name_snapshot",divisionName:"report.division_name_snapshot",usageDepartmentName:"report.usage_department_name_snapshot",responsibleUserIds:responsibleNames,reportDate:"report.report_date",plannedRuntimeMinutes:"report.planned_runtime_minutes",runtimeMinutes:"report.runtime_minutes",utilizationRate,faultMinutes:"report.fault_minutes",faultReason:"report.fault_reason",createdBy:"report.created_by",createdAt:"report.created_at",updatedBy:"report.updated_by",updatedAt:"report.updated_at" };
    this.assertSortField(input.sortField, sortColumns, "equipment-status-report", actor);
    const sortColumn = sortColumns[input.sortField ?? ""];
    const orderBy = sortColumn ? `${sortColumn} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST` : "report.report_date DESC,report.division_name_snapshot,report.equipment_code_snapshot";
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM equipment_status_reports report WHERE ${where}`, params);
    params.push(pageSize, offset);
    const rows = await this.dataSource.query(`
      SELECT report.id,report.equipment_id "equipmentId",report.equipment_code_snapshot "equipmentCode",
        report.equipment_name_snapshot "equipmentName",report.division_organization_unit_id "divisionId",
        report.division_name_snapshot "divisionName",report.usage_department_organization_unit_id "usageDepartmentId",
        report.usage_department_name_snapshot "usageDepartmentName",report.report_date "reportDate",
        report.planned_runtime_minutes "plannedRuntimeMinutes",report.runtime_minutes "runtimeMinutes",
        ${utilizationRate} "utilizationRate",report.fault_minutes "faultMinutes",report.fault_reason "faultReason",
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
    const utilizationRate = `(CASE WHEN report.planned_runtime_minutes IS NULL OR report.planned_runtime_minutes <= 0 THEN NULL ELSE report.runtime_minutes::numeric / report.planned_runtime_minutes * 100 END)`;
    const search = String(input.search ?? "").trim();
    if (search) { params.push(`%${search}%`); clauses.push(`(report.equipment_code_snapshot ILIKE $${params.length} OR report.equipment_name_snapshot ILIKE $${params.length} OR report.division_name_snapshot ILIKE $${params.length} OR report.usage_department_name_snapshot ILIKE $${params.length} OR COALESCE(report.fault_reason,'') ILIKE $${params.length})`); }
    this.textFilters(input, params, clauses, {
      divisionName: "report.division_name_snapshot", usageDepartmentName: "report.usage_department_name_snapshot",
      equipmentCode: "report.equipment_code_snapshot", equipmentName: "report.equipment_name_snapshot", reportDate: "report.report_date::text",
      plannedRuntimeMinutes: "report.planned_runtime_minutes::text", runtimeMinutes: "report.runtime_minutes::text", utilizationRate: `${utilizationRate}::text`, faultMinutes: "report.fault_minutes::text", faultReason: "COALESCE(report.fault_reason,'')"
    });
    await this.typedFilter(input, params, clauses, "report", "equipment-status-report", actor);
    const exportSortColumns: Record<string, string> = { equipmentCode: "report.equipment_code_snapshot", equipmentName: "report.equipment_name_snapshot", divisionName: "report.division_name_snapshot", usageDepartmentName: "report.usage_department_name_snapshot", reportDate: "report.report_date", plannedRuntimeMinutes: "report.planned_runtime_minutes", runtimeMinutes: "report.runtime_minutes", faultMinutes: "report.fault_minutes", faultReason: "report.fault_reason" };
    this.assertSortField(input.sortField, exportSortColumns, "equipment-status-report", actor);
    const exportOrder = input.sortField ? `${exportSortColumns[input.sortField]} ${input.sortOrder === "desc" ? "DESC" : "ASC"} NULLS LAST` : "report.report_date DESC,report.division_name_snapshot,report.equipment_code_snapshot";
    return this.dataSource.query(`SELECT report.division_name_snapshot "divisionName",report.equipment_code_snapshot "equipmentCode",
      report.equipment_name_snapshot "equipmentName",report.usage_department_name_snapshot "usageDepartmentName",report.report_date "reportDate",
      report.planned_runtime_minutes "plannedRuntimeMinutes",report.runtime_minutes "runtimeMinutes",${utilizationRate} "utilizationRate",report.fault_minutes "faultMinutes",report.fault_reason "faultReason"
      FROM equipment_status_reports report WHERE ${clauses.join(" AND ")}
      ORDER BY ${exportOrder}`, params);
  }

  async assetFormOptions(actor: EquipmentActor) {
    if (!["read", "create", "update"].some((action) => hasEquipmentPermission(actor, "equipment-register", action))) throw new ForbiddenException("没有设备总台账权限");
    const [users, organizations, faultReasons] = await Promise.all([
      this.dataSource.query(`SELECT id,display_name "displayName",enabled FROM users WHERE enabled=true ORDER BY display_name`),
      this.organizationOptions(),
      this.dataSource.query(`SELECT dv.value FROM dictionary_values dv JOIN dictionary_types dt ON dt.id=dv.type_id WHERE dt.code='equipmentFaultReason' AND dv.enabled=true ORDER BY dv.sort_order,dv.value`)
    ]);
    return { equipment: [], users, organizations, faultReasons: faultReasons.map((row: any) => row.value) };
  }

  async statusFormOptions(actor: EquipmentActor) {
    const canCreate = hasEquipmentPermission(actor, "equipment-status-report", "create");
    const canUpdate = hasEquipmentPermission(actor, "equipment-status-report", "update");
    if (!canCreate && !canUpdate) throw new ForbiddenException("没有设备状态填报的新增或编辑权限");
    const params: unknown[] = [actor.tenantId];
    const referenceScope = canCreate ? this.referenceCreationScopeClause(actor, "equipment-status-report", "asset", params) : "1=0";
    const [equipment, faultReasons] = await Promise.all([
      this.dataSource.query(`SELECT asset.id,asset.equipment_code "equipmentCode",asset.equipment_name "equipmentName",asset.division_organization_unit_id "divisionId",asset.division_name_snapshot "divisionName",asset.usage_department_organization_unit_id "usageDepartmentId",asset.usage_department_name_snapshot "usageDepartmentName",asset.planned_startup_minutes "plannedStartupMinutes" FROM equipment_assets asset WHERE asset.tenant_id=$1 AND asset.active=true AND asset.monitored=true AND ${referenceScope} ORDER BY asset.equipment_code,asset.division_name_snapshot`, params),
      this.dataSource.query(`SELECT dv.value FROM dictionary_values dv JOIN dictionary_types dt ON dt.id=dv.type_id WHERE dt.code='equipmentFaultReason' AND dv.enabled=true ORDER BY dv.sort_order,dv.value`)
    ]);
    return { equipment, users: [], organizations: [], faultReasons: faultReasons.map((row: any) => row.value) };
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
    const operationsYesterday = this.addDays(this.shanghaiDate(), -1);
    const operationsStart = this.addDays(operationsYesterday, -6);
    params.push(operationsStart, operationsYesterday);
    const [operationsStartParam, operationsEndParam] = [params.length - 1, params.length];
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
      ), daily_reports AS MATERIALIZED (
        SELECT DISTINCT ON (report.equipment_id) report.* FROM window_reports report CROSS JOIN bounds
        WHERE report.report_date=bounds.window_end
        ORDER BY report.equipment_id,report.updated_at DESC
      ), operations_bounds AS (
        SELECT $${operationsStartParam}::date window_start,$${operationsEndParam}::date window_end
      ), operations_dates AS (
        SELECT generate_series(window_start,window_end,interval '1 day')::date report_date FROM operations_bounds
      ), operations_reports AS MATERIALIZED (
        SELECT report.* FROM equipment_status_reports report JOIN monitored asset ON asset.id=report.equipment_id CROSS JOIN operations_bounds
        WHERE report.tenant_id=$1 AND report.active=true AND report.report_date BETWEEN operations_bounds.window_start AND operations_bounds.window_end
      ), operations_daily AS (
        SELECT dates.report_date,
          (SELECT count(*)::integer FROM monitored) expected_equipment_count,
          count(DISTINCT report.equipment_id)::integer filled_equipment_count,
          COALESCE(sum(report.planned_runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer planned_runtime_minutes,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(report.runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer utilization_runtime_minutes
        FROM operations_dates dates LEFT JOIN operations_reports report ON report.report_date=dates.report_date
        GROUP BY dates.report_date
      ), operations_divisions AS (
        SELECT asset.division_organization_unit_id division_id,asset.division_name_snapshot division
        FROM monitored asset
        GROUP BY asset.division_organization_unit_id,asset.division_name_snapshot
      ), operations_division_daily AS (
        SELECT dates.report_date,divisions.division_id,divisions.division,
          count(DISTINCT asset.id)::integer expected_equipment_count,
          count(DISTINCT report.equipment_id)::integer filled_equipment_count,
          COALESCE(sum(report.planned_runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer planned_runtime_minutes,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(report.runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer utilization_runtime_minutes
        FROM operations_dates dates CROSS JOIN operations_divisions divisions
        LEFT JOIN monitored asset
          ON asset.division_organization_unit_id IS NOT DISTINCT FROM divisions.division_id
          AND asset.division_name_snapshot IS NOT DISTINCT FROM divisions.division
        LEFT JOIN operations_reports report ON report.equipment_id=asset.id AND report.report_date=dates.report_date
        GROUP BY dates.report_date,divisions.division_id,divisions.division
      ), operations_division_trends AS (
        SELECT division_id,division,jsonb_agg(jsonb_build_object(
          'date',report_date,'expectedEquipmentCount',expected_equipment_count,'filledEquipmentCount',filled_equipment_count,
          'unfilledEquipmentCount',expected_equipment_count-filled_equipment_count,
          'reportingRate',CASE WHEN expected_equipment_count>0 THEN round(filled_equipment_count::numeric/expected_equipment_count*100,1) ELSE NULL END,
          'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
          'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END
        ) ORDER BY report_date) trend_rows
        FROM operations_division_daily
        GROUP BY division_id,division
      ), operations_yesterday_department AS (
        SELECT asset.division_organization_unit_id division_id,asset.division_name_snapshot division,
          asset.usage_department_organization_unit_id department_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门') department,
          count(DISTINCT asset.id)::integer expected_equipment_count,
          count(DISTINCT report.equipment_id)::integer filled_equipment_count,
          COALESCE(sum(report.planned_runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer planned_runtime_minutes,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(report.runtime_minutes) FILTER (WHERE report.planned_runtime_minutes IS NOT NULL AND report.planned_runtime_minutes>0),0)::integer utilization_runtime_minutes
        FROM monitored asset LEFT JOIN operations_reports report
          ON report.equipment_id=asset.id AND report.report_date=(SELECT window_end FROM operations_bounds)
        GROUP BY asset.division_organization_unit_id,asset.division_name_snapshot,asset.usage_department_organization_unit_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门')
      ), operations_yesterday_division AS (
        SELECT division_id,division,
          sum(expected_equipment_count)::integer expected_equipment_count,
          sum(filled_equipment_count)::integer filled_equipment_count,
          sum(planned_runtime_minutes)::integer planned_runtime_minutes,
          sum(runtime_minutes)::integer runtime_minutes,
          sum(utilization_runtime_minutes)::integer utilization_runtime_minutes
        FROM operations_yesterday_department
        GROUP BY division_id,division
      ), operations_yesterday_department_rows AS (
        SELECT division_id,division,department_id,department,
          expected_equipment_count,filled_equipment_count,planned_runtime_minutes,runtime_minutes,utilization_runtime_minutes
        FROM operations_yesterday_department
      ), operations_yesterday_division_rows AS (
        SELECT division_id,division,
          expected_equipment_count,filled_equipment_count,planned_runtime_minutes,runtime_minutes,utilization_runtime_minutes
        FROM operations_yesterday_division
      ), equipment_duration AS (
        SELECT asset.id equipment_id,asset.division_organization_unit_id division_id,asset.division_name_snapshot division,
          asset.usage_department_organization_unit_id department_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门') department,
          COALESCE(sum(report.runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(report.runtime_minutes) FILTER (WHERE report.planned_runtime_minutes>0),0)::integer utilization_runtime_minutes,
          sum(report.planned_runtime_minutes) FILTER (WHERE report.planned_runtime_minutes>0)::integer planned_runtime_minutes,
          COALESCE(sum(report.fault_minutes),0)::integer fault_minutes
        FROM monitored asset LEFT JOIN window_reports report ON report.equipment_id=asset.id
        GROUP BY asset.id,asset.division_organization_unit_id,asset.division_name_snapshot,asset.usage_department_organization_unit_id,COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门')
      ), asset_state AS (
        SELECT asset.id,asset.division_organization_unit_id division_id,asset.division_name_snapshot division,
          asset.usage_department_organization_unit_id department_id,
          COALESCE(NULLIF(asset.usage_department_name_snapshot,''),'未指定部门') department,
          CASE WHEN daily.id IS NULL THEN '未填报' WHEN daily.fault_minutes>0 THEN '存在故障' WHEN daily.runtime_minutes>0 THEN '正常运行' ELSE '未运行' END state
        FROM monitored asset LEFT JOIN daily_reports daily ON daily.equipment_id=asset.id
      ), division_state AS (
        SELECT division_id,division,count(*)::integer equipment_count,
          count(*) FILTER (WHERE state='正常运行')::integer normal_count,
          count(*) FILTER (WHERE state='存在故障')::integer fault_count,
          count(*) FILTER (WHERE state='未运行')::integer idle_count,
          count(*) FILTER (WHERE state='未填报')::integer unreported_count
        FROM asset_state GROUP BY division_id,division
      ), division_duration AS (
        SELECT division_id,division,COALESCE(sum(runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(utilization_runtime_minutes),0)::integer utilization_runtime_minutes,
          COALESCE(sum(planned_runtime_minutes),0)::integer planned_runtime_minutes,COALESCE(sum(fault_minutes),0)::integer fault_minutes
        FROM equipment_duration GROUP BY division_id,division
      ), division_analysis AS (
        SELECT state.division,state.equipment_count,state.normal_count,state.fault_count,state.idle_count,state.unreported_count,
          duration.planned_runtime_minutes,duration.runtime_minutes,duration.fault_minutes,
          CASE WHEN duration.planned_runtime_minutes>0 THEN round(duration.utilization_runtime_minutes::numeric/duration.planned_runtime_minutes*100,1) ELSE NULL END utilization_rate,
          round(duration.runtime_minutes::numeric/(SELECT window_days FROM bounds))::integer runtime_daily_average_minutes,
          round(duration.fault_minutes::numeric/(SELECT window_days FROM bounds))::integer fault_daily_average_minutes
        FROM division_state state JOIN division_duration duration ON duration.division_id=state.division_id
      ), department_state AS (
        SELECT division_id,division,department_id,department,count(*)::integer equipment_count,
          count(*) FILTER (WHERE state='正常运行')::integer normal_count,
          count(*) FILTER (WHERE state='存在故障')::integer fault_count,
          count(*) FILTER (WHERE state='未运行')::integer idle_count,
          count(*) FILTER (WHERE state='未填报')::integer unreported_count
        FROM asset_state GROUP BY division_id,division,department_id,department
      ), department_duration AS (
        SELECT division_id,division,department_id,department,COALESCE(sum(runtime_minutes),0)::integer runtime_minutes,
          COALESCE(sum(utilization_runtime_minutes),0)::integer utilization_runtime_minutes,
          COALESCE(sum(planned_runtime_minutes),0)::integer planned_runtime_minutes,COALESCE(sum(fault_minutes),0)::integer fault_minutes
        FROM equipment_duration GROUP BY division_id,division,department_id,department
      ), department_analysis AS (
        SELECT state.division,state.department_id,state.department,state.equipment_count,state.normal_count,state.fault_count,state.idle_count,state.unreported_count,
          duration.planned_runtime_minutes,duration.runtime_minutes,duration.fault_minutes,
          CASE WHEN duration.planned_runtime_minutes>0 THEN round(duration.utilization_runtime_minutes::numeric/duration.planned_runtime_minutes*100,1) ELSE NULL END utilization_rate,
          round(duration.runtime_minutes::numeric/(SELECT window_days FROM bounds))::integer runtime_daily_average_minutes,
          round(duration.fault_minutes::numeric/(SELECT window_days FROM bounds))::integer fault_daily_average_minutes
        FROM department_state state JOIN department_duration duration
          ON duration.division_id=state.division_id
          AND duration.department_id IS NOT DISTINCT FROM state.department_id AND duration.department=state.department
      )
      SELECT jsonb_build_object(
        'windowStart',(SELECT window_start FROM bounds),'windowEnd',(SELECT window_end FROM bounds),'windowDays',(SELECT window_days FROM bounds),
        'metrics',jsonb_build_object(
          'totalEquipment',(SELECT count(*) FROM eligible),'firstBatchMonitoringEquipment',(SELECT count(*) FROM monitored),
          'pendingGoLiveEquipment',(SELECT count(*) FROM eligible WHERE monitored=false),
          'dailyRecordedEquipment',(SELECT count(*) FROM asset_state WHERE state<>'未填报'),
          'plannedRuntimeMinutes',(SELECT COALESCE(sum(planned_runtime_minutes),0) FROM equipment_duration),
          'runtimeMinutes',(SELECT COALESCE(sum(runtime_minutes),0) FROM equipment_duration),'faultMinutes',(SELECT COALESCE(sum(fault_minutes),0) FROM equipment_duration),
          'utilizationRate',CASE WHEN (SELECT COALESCE(sum(planned_runtime_minutes),0) FROM equipment_duration)>0 THEN round((SELECT COALESCE(sum(utilization_runtime_minutes),0) FROM equipment_duration)::numeric/(SELECT sum(planned_runtime_minutes) FROM equipment_duration)*100,1) ELSE NULL END,
          'runtimeDailyAverageMinutes',round((SELECT COALESCE(sum(runtime_minutes),0) FROM window_reports)::numeric/(SELECT window_days FROM bounds))::integer,
          'faultDailyAverageMinutes',round((SELECT COALESCE(sum(fault_minutes),0) FROM window_reports)::numeric/(SELECT window_days FROM bounds))::integer,
          'normalEquipment',(SELECT count(*) FROM asset_state WHERE state='正常运行'),'faultEquipment',(SELECT count(*) FROM asset_state WHERE state='存在故障'),
          'idleEquipment',(SELECT count(*) FROM asset_state WHERE state='未运行')
        ),
        'divisionRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'division',division,'equipmentCount',equipment_count,'normalCount',normal_count,'faultCount',fault_count,
          'idleCount',idle_count,'unreportedCount',unreported_count,'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,'utilizationRate',utilization_rate,'faultMinutes',fault_minutes,
          'runtimeDailyAverageMinutes',runtime_daily_average_minutes,'faultDailyAverageMinutes',fault_daily_average_minutes
        ) ORDER BY division) FROM division_analysis),'[]'::jsonb),
        'departmentRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'division',division,'departmentId',department_id,'department',department,'equipmentCount',equipment_count,'normalCount',normal_count,'faultCount',fault_count,
          'idleCount',idle_count,'unreportedCount',unreported_count,'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,'utilizationRate',utilization_rate,'faultMinutes',fault_minutes,
          'runtimeDailyAverageMinutes',runtime_daily_average_minutes,'faultDailyAverageMinutes',fault_daily_average_minutes
        ) ORDER BY division,department) FROM department_analysis),'[]'::jsonb),
        'equipmentRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'division',division,'departmentId',department_id,'department',department,'equipmentId',equipment_id,
          'equipmentCode',asset.equipment_code,'equipmentName',asset.equipment_name,
          'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
          'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END,
          'faultMinutes',fault_minutes
        ) ORDER BY division,department,asset.equipment_code) FROM equipment_duration JOIN equipment_assets asset ON asset.id=equipment_duration.equipment_id),'[]'::jsonb),
        'operationsMonitoring',jsonb_build_object(
          'yesterday',(SELECT jsonb_build_object(
            'date',report_date,'expectedEquipmentCount',expected_equipment_count,'filledEquipmentCount',filled_equipment_count,
            'unfilledEquipmentCount',expected_equipment_count-filled_equipment_count,
            'reportingRate',CASE WHEN expected_equipment_count>0 THEN round(filled_equipment_count::numeric/expected_equipment_count*100,1) ELSE NULL END,
            'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
            'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END
          ) FROM operations_daily WHERE report_date=(SELECT window_end FROM operations_bounds)),
          'yesterdayDivisionRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'divisionId',division_id,'division',division,
            'expectedEquipmentCount',expected_equipment_count,'filledEquipmentCount',filled_equipment_count,
            'unfilledEquipmentCount',expected_equipment_count-filled_equipment_count,
            'reportingRate',CASE WHEN expected_equipment_count>0 THEN round(filled_equipment_count::numeric/expected_equipment_count*100,1) ELSE NULL END,
            'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
            'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END
          ) ORDER BY CASE division WHEN '凯南事业一部' THEN 1 WHEN '事业一部' THEN 1 WHEN '凯南事业二部' THEN 2 WHEN '事业二部' THEN 2 WHEN '凯南事业三部' THEN 3 WHEN '事业三部' THEN 3 WHEN '凯南事业四部' THEN 4 WHEN '事业四部' THEN 4 ELSE 99 END,division) FROM operations_yesterday_division_rows),'[]'::jsonb),
          'yesterdayDepartmentRows',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'divisionId',division_id,'division',division,'departmentId',department_id,'department',department,
            'expectedEquipmentCount',expected_equipment_count,'filledEquipmentCount',filled_equipment_count,
            'unfilledEquipmentCount',expected_equipment_count-filled_equipment_count,
            'reportingRate',CASE WHEN expected_equipment_count>0 THEN round(filled_equipment_count::numeric/expected_equipment_count*100,1) ELSE NULL END,
            'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
            'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END
          ) ORDER BY CASE division WHEN '凯南事业一部' THEN 1 WHEN '事业一部' THEN 1 WHEN '凯南事业二部' THEN 2 WHEN '事业二部' THEN 2 WHEN '凯南事业三部' THEN 3 WHEN '事业三部' THEN 3 WHEN '凯南事业四部' THEN 4 WHEN '事业四部' THEN 4 ELSE 99 END,division,department) FROM operations_yesterday_department_rows),'[]'::jsonb),
          'sevenDayTrend',jsonb_build_object(
            'total',COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'date',report_date,'expectedEquipmentCount',expected_equipment_count,'filledEquipmentCount',filled_equipment_count,
            'reportingRate',CASE WHEN expected_equipment_count>0 THEN round(filled_equipment_count::numeric/expected_equipment_count*100,1) ELSE NULL END,
            'plannedRuntimeMinutes',planned_runtime_minutes,'runtimeMinutes',runtime_minutes,
            'utilizationRate',CASE WHEN planned_runtime_minutes>0 THEN round(utilization_runtime_minutes::numeric/planned_runtime_minutes*100,1) ELSE NULL END
            ) ORDER BY report_date) FROM operations_daily),'[]'::jsonb),
            'divisions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'divisionId',division_id,'divisionName',division,'rows',trend_rows
            ) ORDER BY CASE division WHEN '凯南事业一部' THEN 1 WHEN '事业一部' THEN 1 WHEN '凯南事业二部' THEN 2 WHEN '事业二部' THEN 2 WHEN '凯南事业三部' THEN 3 WHEN '事业三部' THEN 3 WHEN '凯南事业四部' THEN 4 WHEN '事业四部' THEN 4 ELSE 99 END,division)
              FROM operations_division_trends),'[]'::jsonb)
          )
        ),
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
    const periodType = input.periodType ?? "day";
    const today = this.shanghaiDate();
    let windowStart: string; let windowEnd: string;
    if (periodType === "day") {
      const period = input.period ?? this.addDays(today, -1);
      windowStart = this.isoDate(period, "按日筛选日期"); windowEnd = windowStart;
    } else if (periodType === "month") {
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

  private shanghaiDate() {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    return `${value("year")}-${value("month")}-${value("day")}`;
  }

  private addDays(value: string, days: number) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
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

  private assertSortField(key: string | undefined, columns: Record<string, string>, resource: string, actor: EquipmentActor) {
    if (!key) return;
    if (!columns[key]) throw new BadRequestException("排序字段无效");
    const field = key === "divisionName" ? "divisionId" : key === "usageDepartmentName" ? "usageDepartmentId" : key;
    if (!(actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
      || actor.permissions.includes(`${resource}:${field}:read`))) {
      throw new ForbiddenException("当前权限组不能按该字段排序");
    }
  }

  private scopeClause(actor: EquipmentActor, resource: string, action: string, alias: string, params: unknown[]) {
    return equipmentScopeClause(actor, resource, action, alias, params);
  }

  /**
   * KN-FILTER-001：设备模块接入平台类型化筛选，复用同一个 `SqlFilterCompiler`（不得另写一套）。
   * 字段表达式按资源+别名生成，字典字段（故障原因）先按正式字典表把 label 解析成 value。
   */
  private async typedFilter(input: PageInput, params: unknown[], clauses: string[], alias: string, resource: "equipment-register" | "equipment-status-report", actor: EquipmentActor) {
    if (input.filterGroup == null || String(input.filterGroup).trim() === "") return;
    const dictionary = resource === "equipment-status-report" ? await this.faultReasonDictionary() : null;
    const compiler = new SqlFilterCompiler(
      tablePermissionFieldsFor(resource),
      this.filterColumns(alias, resource),
      (key) => actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("planning") === true
        || actor.permissions.includes(`${resource}:${key}:read`),
      (column) => column,
      dictionary ? (field, raw) => (field === "faultReason" ? dictionary.match(raw) : null) : undefined
    );
    clauses.push(compiler.compile(input.filterGroup, params));
  }

  private filterColumns(alias: string, resource: "equipment-register" | "equipment-status-report"): Record<string, string> {
    const members = `COALESCE((SELECT jsonb_agg(er.user_id) FROM equipment_responsibles er WHERE er.tenant_id=${alias}.tenant_id AND er.equipment_id=${alias}.id),'[]'::jsonb)`;
    if (resource === "equipment-register") return {
      divisionId: `${alias}.division_organization_unit_id`, usageDepartmentId: `${alias}.usage_department_organization_unit_id`,
      equipmentCode: `${alias}.equipment_code`, equipmentName: `${alias}.equipment_name`, purchaseDate: `${alias}.purchase_date`,
      plannedStartupMinutes: `${alias}.planned_startup_minutes`, monitored: `${alias}.monitored`, responsibleUserIds: members,
      createdBy: `${alias}.created_by`, createdAt: `${alias}.created_at`, updatedBy: `${alias}.updated_by`, updatedAt: `${alias}.updated_at`
    };
    return {
      equipmentId: `${alias}.equipment_id`, equipmentCode: `${alias}.equipment_code_snapshot`, equipmentName: `${alias}.equipment_name_snapshot`,
      divisionId: `${alias}.division_organization_unit_id`, usageDepartmentId: `${alias}.usage_department_organization_unit_id`,
      responsibleUserIds: members, reportDate: `${alias}.report_date`, plannedRuntimeMinutes: `${alias}.planned_runtime_minutes`, runtimeMinutes: `${alias}.runtime_minutes`,
      faultMinutes: `${alias}.fault_minutes`, faultReason: `${alias}.fault_reason`,
      createdBy: `${alias}.created_by`, createdAt: `${alias}.created_at`, updatedBy: `${alias}.updated_by`, updatedAt: `${alias}.updated_at`
    };
  }

  /**
   * 设备故障原因字典：`dictionary_values` 只存 `value`（中文选项即 value，没有独立 label 列），
   * 因此按 value 精确命中；未命中返回 null（由编译器按原值处理）。
   */
  private async faultReasonDictionary() {
    const rows: Array<{ value: string }> = await this.dataSource.query(
      `SELECT dv.value FROM dictionary_values dv JOIN dictionary_types dt ON dt.id=dv.type_id WHERE dt.code='equipmentFaultReason' AND dv.enabled=true`
    );
    return {
      match: (raw: string) => {
        const matched = rows.filter((row) => row.value === raw).map((row) => row.value);
        return matched.length ? matched : null;
      }
    };
  }

  /** KN-EQUIP-001：候选设备与新增加载共用同一 create 范围实现（equipmentCreateScopeClause）。 */
  private referenceCreationScopeClause(actor: EquipmentActor, resource: string, alias: string, params: unknown[]) {
    return equipmentCreateScopeClause(actor, resource, alias, params);
  }

  private page(input: PageInput) {
    const page = Math.max(1, Number(input.page ?? 1)); const requested = Number(input.pageSize ?? 100);
    const pageSize = [20, 50, 100, 200].includes(requested) ? requested : 100;
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

  private booleanLabelFilter(raw: unknown, params: unknown[], clauses: string[], column: string, trueLabel: string, falseLabel: string) {
    const value = String(raw ?? "").trim().toLocaleLowerCase();
    if (!value) return;
    const matchesTrue = trueLabel.toLocaleLowerCase().includes(value) || ["true", "1", "是"].includes(value);
    const matchesFalse = falseLabel.toLocaleLowerCase().includes(value) || ["false", "0", "否"].includes(value);
    if (matchesTrue && matchesFalse) return;
    if (!matchesTrue && !matchesFalse) { clauses.push("1=0"); return; }
    params.push(matchesTrue); clauses.push(`${column}=$${params.length}`);
  }
}
