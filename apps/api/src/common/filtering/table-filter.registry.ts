import { Injectable, NotFoundException } from "@nestjs/common";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";

/** 平台筛选 actor 视图：只暴露筛选所需的最小身份与数据范围信息。 */
export type TableFilterActor = {
  tenantId: string; userId: string | null; permissions: string[]; roles?: string[];
  isSystemAdmin?: boolean; moduleAdminCodes?: string[];
  tableDataScopes?: Array<{ resource: string; scope: string; match?: string; actions?: string[]; rules?: Array<{ fieldKey?: string; operator?: string; value?: unknown }> }>;
  hasPermission?: (resource: string, action: string) => boolean;
  hasFieldPermission?: (resource: string, field: string, action: "read" | "update") => boolean;
};

export type TableFilterSource = {
  /** 资源 code（tableResourceRegistry 内的稳定值）。 */
  code: string;
  /** 物理表名。 */
  table: string;
  /** field key → 列名（不含别名）。 */
  columns: Record<string, string>;
  /**
   * 该资源的租户列名。默认 `tenant_id`；ERP 镜像表（sales_orders 等）与审计日志没有租户列时显式传 `null`，
   * 此时租户隔离由资源权限与数据范围承担，平台不得伪造租户条件。
   */
  tenantColumn?: string | null;
  /** field key → 完整 SQL 表达式（用于虚拟列/关联列）；优先于 columns。 */
  expressions?: Record<string, string>;
  /**
   * 可选查询执行器：资源所在的物理库与平台默认 DataSource 不同时使用
   * （例如 KDOS 库 `marketing.*` 的营销资源）。不提供时使用平台默认 DataSource。
   */
  runQuery?: (sql: string, params: unknown[]) => Promise<any[]>;
  /** 该资源自己的成员候选来源（跨库资源必须提供，例如 KDOS 营销表的业务员）。 */
  memberCandidates?: (search: string, limit: number) => Promise<Array<{ value: string; label: string }>>;
  /** 该资源自己的部门候选来源（跨库资源必须提供）。 */
  departmentCandidates?: (search: string, limit: number) => Promise<Array<{ value: string; label: string }>>;
  /**
   * 资源级授权：平台 rows/candidate 入口在读取前必须调用（例如系统管理资源仅系统管理员 + 模块管理员）。
   * 未提供时按字段读权限判定，与各模块现有 read 权限保持一致。
   */
  authorize?: (actor: TableFilterActor) => void;
  /** 快速搜索使用的列（默认取 text/数字/日期/字典类字段列）。 */
  searchColumns?: string[];
  /** 该资源的字段定义（默认取 tablePermissionFieldsFor）。 */
  fields: TablePermissionFieldDefinition[];
  /** 生成带租户与数据范围的 WHERE 片段（params 顺序追加）。 */
  buildScope: (actor: TableFilterActor, params: unknown[]) => string;
};

/**
 * KN-FILTER-001 平台筛选数据源注册表。
 * 每个接入的模块在启动时注册自己的资源（表、字段列映射、租户+数据范围构造），
 * 平台 candidate / export / filter 能力据此工作；模块不得各自复制筛选编译器。
 */
@Injectable()
export class TableFilterRegistry {
  private readonly sources = new Map<string, TableFilterSource>();

  register(source: TableFilterSource) {
    this.sources.set(source.code, source);
  }

  has(code: string) { return this.sources.has(code); }

  get(code: string) {
    const source = this.sources.get(code);
    if (!source) throw new NotFoundException(`该表暂未接入统一筛选平台：${code}`);
    return source;
  }

  codes() { return [...this.sources.keys()]; }

  /**
   * 启动闸门：contracts 声明的 REGISTERED_AND_FILTERABLE 资源集合必须与运行时注册表完全一致。
   * 少注册 = 前端能力声明说谎（UI 显示筛选但服务端忽略）；多注册 = 未纳入契约审计。
   */
  assertDeclaredCodes(declared: string[]) {
    const registered = new Set(this.sources.keys());
    const declaredSet = new Set(declared);
    const missing = [...declaredSet].filter((code) => !registered.has(code));
    const extra = [...registered].filter((code) => !declaredSet.has(code));
    if (missing.length || extra.length) {
      throw new Error(`KN-FILTER-001 筛选能力声明与运行时注册表不一致：未注册=${missing.join(",") || "无"}；未声明=${extra.join(",") || "无"}`);
    }
  }
}
