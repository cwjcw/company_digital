import { ForbiddenException, Injectable, type OnModuleInit } from "@nestjs/common";
import { DataSource } from "typeorm";
import { AdminQueryService } from "../../modules/admin/admin-query.service";
import { tablePermissionFieldsFor, type TableResourceCode } from "@kdos/contracts";
import { TableFilterRegistry, type TableFilterActor } from "./table-filter.registry";

/**
 * KN-FILTER-001 系统管理/流程资源筛选数据源（默认 DataSource）。
 *
 * 授权沿用各模块现有正式权限，不放宽也不收紧：
 * - 系统管理资源（字典、工序、用户、角色、组织架构、通讯录、API Key）：系统管理员或对应模块管理员；
 * - 审批流程配置：系统管理员、流程审批模块管理员或 `flow_config_administrators` 角色（与 ApprovalFlowConfigService 一致）；
 * - 需求提报与审批：系统管理员或流程审批模块管理员（普通用户一律不可见，见 DevelopmentRequestService）。
 */
const SYSTEM_ADMIN_OK = (actor: TableFilterActor) => actor.isSystemAdmin === true || actor.permissions.includes("*");
const systemModule = (actor: TableFilterActor) => SYSTEM_ADMIN_OK(actor) || (actor.moduleAdminCodes ?? []).includes("system");
const workflowModule = (actor: TableFilterActor) => SYSTEM_ADMIN_OK(actor) || (actor.moduleAdminCodes ?? []).includes("workflow");

const authorized = (check: (actor: TableFilterActor) => boolean, message: string) => (actor: TableFilterActor) => {
  if (!check(actor)) throw new ForbiddenException(message);
};

type Source = {
  code: TableResourceCode;
  dictionaryCandidates?: (fieldKey: string, search: string, limit: number) => Promise<Array<{ value: string; label: string }>>;
  table: string;
  columns: Record<string, string>;
  expressions?: Record<string, string>;
  authorize?: (actor: TableFilterActor) => void;
  searchColumns?: string[];
};

const SOURCES: Source[] = [
  {
    code: "processes",
    table: "process_definitions",
    authorize: authorized(systemModule, "仅系统管理员或系统管理模块管理员可以访问工序管理"),
    columns: {
      code: "code", name: "name", sortOrder: "sort_order", enableRequiredDays: "enable_required_days",
      enableDueDate: "enable_due_date", enableStatus: "enable_status", enableException: "enable_exception", enabled: "enabled",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  },
  {
    code: "users",
    table: "users",
    authorize: authorized(systemModule, "仅系统管理员或系统管理模块管理员可以访问用户管理"),
    columns: {
      username: "username", displayName: "display_name", employeeNo: "employee_no", wechatUserId: "wechat_user_id",
      position: "position", alias: "alias", gender: "gender", mobile: "mobile", email: "email", division: "division",
      enabled: "enabled", lastLoginAt: "last_login_at", departmentPaths: "department_paths",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    expressions: {
      /* 角色是真实关系：jsonb 数组（按角色 ID 包含匹配）；departmentPaths 仅展示（metadata filterable=false）。 */
      roleIds: `(SELECT COALESCE(jsonb_agg(link.role_id),'[]'::jsonb) FROM user_roles link WHERE link.user_id = record.id)`
    },
    searchColumns: ["username", "displayName", "employeeNo", "mobile", "email", "position"]
  },
  {
    code: "dictionaries",
    /* 字典真实来源是类型表 + 值表：用 relation/custom binding（子查询作为来源）接入统一编译器，不另写 DictionaryFilterCompiler。 */
    table: `(SELECT value_row.id, value_row.value, value_row.sort_order, value_row.enabled, value_row.version,
        value_row.created_by, value_row.created_at, value_row.updated_by, value_row.updated_at,
        type_row.id AS type_id, type_row.code, type_row.name AS type_name, type_row.version AS type_version
      FROM dictionary_values value_row JOIN dictionary_types type_row ON type_row.id = value_row.type_id)`,
    authorize: authorized(systemModule, "仅系统管理员或系统管理模块管理员可以访问字典管理"),
    columns: {
      id: "id", typeId: "type_id", version: "version", typeVersion: "type_version",
      typeCode: "code", typeName: "type_name", value: "value", sortOrder: "sort_order", enabled: "enabled",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    }
  },
  {
    code: "organization",
    table: "organization_units",
    authorize: authorized(systemModule, "仅系统管理员或系统管理模块管理员可以访问组织架构"),
    columns: {
      name: "name", parentId: "parent_id", wechatDepartmentId: "wechat_department_id", level: "level", division: "division",
      leaderUserIds: "leader_user_ids", enabled: "enabled", sortOrder: "sort_order",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    expressions: {
      /* 计算列以真实关系/聚合实现，属于 virtual/aggregate binding，不改变存储。 */
      pathLabel: `(WITH RECURSIVE chain AS (
          SELECT unit.id, unit.parent_id, unit.name, unit.name::text AS path, 1 AS depth FROM organization_units unit WHERE unit.id = record.id
          UNION ALL
          SELECT parent.id, parent.parent_id, parent.name, parent.name || ' / ' || chain.path, chain.depth + 1
          FROM organization_units parent JOIN chain ON parent.id = chain.parent_id
        ) SELECT path FROM chain ORDER BY depth DESC LIMIT 1)`,
      /* 返回 jsonb 数组（前端按数组渲染）；筛选时按聚合文本做包含匹配。 */
      leaderNames: `(SELECT COALESCE(jsonb_agg(member.display_name ORDER BY member.display_name),'[]'::jsonb) FROM jsonb_array_elements_text(record.leader_user_ids) AS leader(user_id) JOIN users member ON member.id = leader.user_id::uuid)`,
      memberCount: `(SELECT count(*) FROM users member WHERE member.enabled = true AND member.department_paths @> to_jsonb(ARRAY[record.name::text]))`
    },
    searchColumns: ["name", "wechatDepartmentId", "division"]
  },
  {
    code: "contacts",
    table: "contacts",
    authorize: authorized(systemModule, "仅系统管理员或系统管理模块管理员可以访问通讯录"),
    columns: {
      employeeNo: "employee_no", name: "name", position: "position", telephone: "telephone",
      wechatUserId: "wechat_user_id", enabled: "enabled", importedAt: "imported_at",
      /* jsonb 仅用于展示（metadata filterable=false），不参与筛选。 */
      departmentPaths: "department_paths", directLeaders: "direct_leaders",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    searchColumns: ["employeeNo", "name", "position", "telephone"]
  },
  {
    code: "api-keys",
    table: "api_keys",
    authorize: authorized(SYSTEM_ADMIN_OK, "仅系统管理员可以访问 API Key 管理"),
    columns: {
      name: "name", userId: "user_id", roleId: "role_id", enabled: "enabled", expiresAt: "expires_at", lastUsedAt: "last_used_at",
      scopes: "scopes",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    searchColumns: ["name"]
  },
  {
    code: "approval-flow-configs",
    table: "approval_flow_configs",
    authorize: authorized(
      (actor: TableFilterActor) => workflowModule(actor) || (actor.roles ?? []).some((role: string) => ["系统管理员", "集团管理员"].includes(role)),
      "仅系统管理员、流程审批模块管理员或集团管理员可以访问审批流程配置"
    ),
    columns: {
      flowKey: "flow_key", name: "name", enabled: "enabled", allowDraft: "allow_draft", allowWithdraw: "allow_withdraw",
      returnMode: "return_mode", rejectTargetMode: "reject_target_mode", approvalCommentRequired: "approval_comment_required",
      adminRoleNames: "admin_role_names", nodeLabels: "node_labels",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    searchColumns: ["flowKey", "name"]
  },
  {
    code: "development-requests",
    table: "development_requests",
    authorize: authorized(workflowModule, "需求提报与审批数据仅系统管理员或流程审批模块管理员可以查看"),
    columns: {
      requestNumber: "request_number", title: "title", category: "category", description: "description",
      businessValue: "business_value", urgency: "urgency", desiredDate: "desired_date", status: "status",
      requesterId: "requester_id", requesterManagerId: "requester_manager_id", handlerId: "handler_id",
      handlerManagerId: "handler_manager_id", estimatedWorkdays: "estimated_workdays", plannedCompletionDate: "planned_completion_date",
      createdBy: "created_by", createdAt: "created_at", updatedBy: "updated_by", updatedAt: "updated_at"
    },
    searchColumns: ["requestNumber", "title", "category", "description"]
  }
];

@Injectable()
export class SystemFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly dataSource: DataSource, private readonly adminQueries: AdminQueryService) {}

  onModuleInit() {
    for (const source of SOURCES) {
      /* 角色候选来自正式 roles 表（用户与角色是真实关系），只提供 ID + 名称，不暴露任何权限明细。 */
      const dictionaryCandidates = source.code === "users"
        ? async (fieldKey: string, search: string, limit: number) => {
          if (fieldKey !== "roleIds") return [];
          const rows: Array<{ value: string; label: string }> = await this.dataSource.query(
            /* 只提供普通角色（排除权限组专用角色与系统管理员），与 /admin/roles 的可分配角色一致。 */
            `SELECT id AS value, name AS label FROM roles
              WHERE permission_group_resource IS NULL AND name <> '系统管理员' AND ($1='' OR name ILIKE $2)
              ORDER BY name LIMIT $3`,
            [search, `%${search}%`, limit]
          );
          return rows.map((row) => ({ value: String(row.value), label: String(row.label) }));
        }
        : source.dictionaryCandidates;
      this.registry.register({
        code: source.code,
        table: source.table,
        columns: source.columns,
        expressions: source.expressions,
        fields: tablePermissionFieldsFor(source.code),
        authorize: source.authorize,
        /* 系统管理/流程配置表没有 tenant_id 列：隔离由资源与管理权限承担，平台不伪造租户条件。 */
        tenantColumn: null,
        printRows: source.code === "users" ? (query) => this.printUsers(query) : undefined,
        printResolvers: source.code === "users" ? {
          /* 角色列批量解析为正式角色名（一次查询，禁止 N+1）。 */
          roleIds: async (rows) => {
            const ids = [...new Set(rows.flatMap((row) => (row.roleIds as string[] | undefined) ?? []))];
            if (!ids.length) return new Map();
            const roles: Array<{ id: string; name: string }> = await this.dataSource.query("SELECT id, name FROM roles WHERE id = ANY($1::uuid[])", [ids]);
            const names = new Map(roles.map((role) => [String(role.id), String(role.name)]));
            return new Map(rows.map((row) => [String(row.id ?? ""), ((row.roleIds as string[] | undefined) ?? []).map((id) => names.get(id) ?? "").filter(Boolean)]));
          }
        } : undefined,
        dictionaryCandidates,
        searchColumns: source.searchColumns,
        buildScope: () => "1=1"
      });
    }
  }

  /** 用户打印取数：与列表共用同一服务端查询（部门/状态/角色上下文 + 搜索 + FilterGroup + 排序），只是换成打印批大小。 */
  private async printUsers(query: import("./table-filter.registry").TablePrintRowQuery) {
    const context = query.context ?? {};
    return this.adminQueries.listUsersPage({
      page: query.page, pageSize: query.pageSize, batchSize: query.pageSize,
      search: query.search, filterGroup: query.filterGroup, sortField: query.sortField, sortOrder: query.sortOrder,
      departmentId: context.departmentId, status: context.status, roleId: context.roleId,
      ids: query.ids
    }, { isSystemAdmin: query.actor.isSystemAdmin === true, permissions: query.actor.permissions });
  }
}
