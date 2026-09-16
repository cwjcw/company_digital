import { Injectable, NotFoundException } from "@nestjs/common";
import type { TablePermissionFieldDefinition } from "@kdos/contracts";

/** 平台筛选 actor 视图：只暴露筛选所需的最小身份与数据范围信息。 */
export type TableFilterActor = {
  tenantId: string; userId: string | null; permissions: string[];
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
}
