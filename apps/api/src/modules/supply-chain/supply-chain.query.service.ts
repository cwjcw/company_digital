import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { SqlFilterCompiler } from "../../common/filtering/sql-filter.compiler";
import { hasSupplierListPermission, SupplyChainActor } from "./supply-chain.types";

type QueryInput = {
  page?: unknown; pageSize?: unknown; search?: unknown; filters?: unknown; filterGroup?: unknown; sortField?: unknown; sortOrder?: unknown;
};

const columns: Record<string, string> = {
  sourceSystem: "supplier.source_system", sourceDatabase: "supplier.source_database", sourceAccountName: "supplier.source_account_name",
  sourceId: "supplier.source_id", code: "supplier.code", name: "supplier.name", abbreviation: "supplier.abbreviation",
  shorthand: "supplier.shorthand", categoryCode: "supplier.category_code", categoryName: "supplier.category_name",
  partnerTypeLabel: "supplier.partner_type_label", representative: "supplier.representative", contact: "supplier.contact",
  mobilePhone: "supplier.mobile_phone", telephone: "supplier.telephone", fax: "supplier.fax", email: "supplier.email",
  address: "supplier.address", enabled: "supplier.enabled", sourceUpdatedAt: "supplier.source_updated_at",
  createdBy: "supplier.created_by", createdAt: "supplier.created_at", updatedBy: "supplier.updated_by", updatedAt: "supplier.updated_at"
};

const selectAliases: Record<string, string> = Object.fromEntries(Object.entries(columns).map(([key, expression]) => [key, `${expression} "${key}"`]));
const textFields = new Set(Object.keys(columns).filter((key) => key !== "enabled"));

@Injectable()
export class SupplyChainQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async listSuppliers(input: QueryInput, actor: SupplyChainActor) {
    if (!hasSupplierListPermission(actor, "read")) throw new ForbiddenException("当前权限组没有供应商清单查看权限");
    const visibleFields = this.visibleFields(actor);
    if (!visibleFields.length) throw new ForbiddenException("当前权限组没有供应商清单可见字段");
    const page = Math.max(1, Math.floor(Number(input.page) || 1));
    const requestedPageSize = Math.floor(Number(input.pageSize) || 100);
    const pageSize = [20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 100;
    const params: unknown[] = [actor.tenantId];
    const clauses = ["supplier.tenant_id=$1", this.scopeClause(actor, params)];
    const search = String(input.search ?? "").trim();
    const searchable = visibleFields.filter((field) => textFields.has(field));
    if (search && searchable.length) {
      params.push(`%${search}%`);
      clauses.push(`(${searchable.map((field) => `COALESCE(${columns[field]}::text,'') ILIKE $${params.length}`).join(" OR ")})`);
    }
    const filters = this.filters(input.filters);
    for (const [field, rawValue] of Object.entries(filters)) {
      if (!visibleFields.includes(field) || !columns[field]) continue;
      const value = String(rawValue ?? "").trim();
      if (!value) continue;
      if (field === "enabled") this.booleanFilter(value, params, clauses);
      else { params.push(`%${value}%`); clauses.push(`COALESCE(${columns[field]}::text,'') ILIKE $${params.length}`); }
    }
    /* KN-FILTER-001：类型化高级筛选复用平台编译器，与租户、数据范围、搜索、分页/总数同一 where。 */
    if (input.filterGroup != null && String(input.filterGroup).trim() !== "") {
      const compiler = new SqlFilterCompiler(
        tablePermissionFieldsFor("supplier-list"), columns,
        (key) => visibleFields.includes(key),
        (column) => column
      );
      clauses.push(compiler.compile(input.filterGroup, params));
    }
    const where = clauses.join(" AND ");
    const [{ count }] = await this.dataSource.query(`SELECT count(*)::integer count FROM supply_chain_suppliers supplier WHERE ${where}`, params);
    const requestedSort = String(input.sortField ?? "");
    const sortColumn = visibleFields.includes(requestedSort) ? columns[requestedSort] : undefined;
    const orderBy = sortColumn
      ? `${sortColumn} ${String(input.sortOrder) === "desc" ? "DESC" : "ASC"} NULLS LAST`
      : "supplier.source_account_name ASC,supplier.code ASC,supplier.id ASC";
    const selected = visibleFields.map((field) => selectAliases[field]).filter(Boolean);
    params.push(pageSize, (page - 1) * pageSize);
    const rows = await this.dataSource.query(`
      SELECT supplier.id,supplier.version,${selected.join(",")}
      FROM supply_chain_suppliers supplier
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);
    return { rows, total: Number(count), page, pageSize };
  }

  private visibleFields(actor: SupplyChainActor) {
    if (actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("data")) return Object.keys(columns);
    return Object.keys(columns).filter((field) => actor.permissions.includes(`supplier-list:${field}:read`) || actor.permissions.includes(`supplier-list:${field}:update`));
  }

  private filters(raw: unknown): Record<string, unknown> {
    if (raw == null || raw === "") return {};
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      if (Object.keys(parsed).length > Object.keys(columns).length) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException("筛选条件格式无效");
    }
  }

  private booleanFilter(raw: string, params: unknown[], clauses: string[]) {
    const value = raw.toLocaleLowerCase();
    const matchesEnabled = "启用".includes(value) || ["true", "1", "是"].includes(value);
    const matchesDisabled = "停用".includes(value) || ["false", "0", "否"].includes(value);
    if (matchesEnabled && matchesDisabled) return;
    if (!matchesEnabled && !matchesDisabled) { clauses.push("1=0"); return; }
    params.push(matchesEnabled); clauses.push(`supplier.enabled=$${params.length}`);
  }

  private scopeClause(actor: SupplyChainActor, params: unknown[]) {
    if (actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("data")) return "1=1";
    const scopes = (actor.tableDataScopes ?? []).filter((scope) =>
      scope.resource === "supplier-list" && (!Array.isArray(scope.actions) || scope.actions.includes("read"))
    );
    if (scopes.some((scope) => scope.scope === "ALL")) return "1=1";
    const clauses: string[] = [];
    if (actor.userId && scopes.some((scope) => scope.scope === "OWN")) {
      params.push(actor.userId); clauses.push(`supplier.created_by=$${params.length}::uuid`);
    }
    for (const scope of scopes.filter((item) => item.scope === "CUSTOM")) {
      const rules = (scope.rules ?? []).map((rule) => this.ruleClause(rule, actor, params)).filter(Boolean) as string[];
      if (!rules.length) continue;
      clauses.push(`(${rules.join(String(scope.match ?? "ALL") === "ANY" ? " OR " : " AND ")})`);
    }
    return clauses.length ? `(${clauses.join(" OR ")})` : "1=0";
  }

  private ruleClause(rule: { fieldKey?: string; operator?: string; value?: unknown }, actor: SupplyChainActor, params: unknown[]) {
    const field = String(rule.fieldKey ?? ""); const column = columns[field]; const operator = String(rule.operator ?? "");
    if (!column) return "";
    const rawValue = rule.value === "CURRENT_USER" ? actor.userId : rule.value;
    if (operator === "IS_EMPTY") return `(${column} IS NULL OR btrim(${column}::text)='')`;
    if (operator === "IS_NOT_EMPTY") return `(${column} IS NOT NULL AND btrim(${column}::text)<>'')`;
    if (["IN", "NOT_IN"].includes(operator)) {
      const values = Array.isArray(rawValue) ? rawValue.map(String).filter(Boolean) : [];
      if (!values.length) return operator === "IN" ? "1=0" : "1=1";
      params.push(values); return `${column}::text ${operator === "NOT_IN" ? "<> ALL" : "= ANY"}($${params.length}::text[])`;
    }
    if (rawValue === undefined || rawValue === null) return "";
    const comparisons: Record<string, string> = { EQ: "=", NE: "<>", GT: ">", GTE: ">=", LT: "<", LTE: "<=" };
    if (comparisons[operator]) { params.push(String(rawValue)); return `${column}::text ${comparisons[operator]} $${params.length}`; }
    if (["CONTAINS", "NOT_CONTAINS", "STARTS_WITH"].includes(operator)) {
      params.push(operator === "STARTS_WITH" ? `${String(rawValue)}%` : `%${String(rawValue)}%`);
      return `COALESCE(${column}::text,'') ${operator === "NOT_CONTAINS" ? "NOT ILIKE" : "ILIKE"} $${params.length}`;
    }
    return "";
  }
}
