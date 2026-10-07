import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { KnowledgeAccessService, assertKnowledgeAction, knowledgeDataScope, knowledgeSearchClause } from "./knowledge.scope";
import { articleColumns, categoryColumns, knowledgeExpressions, type KnowledgeActor } from "./knowledge.types";

@Injectable()
export class KnowledgeFilterSourceProvider implements OnModuleInit {
  constructor(private readonly registry: TableFilterRegistry, private readonly access: KnowledgeAccessService) {}
  onModuleInit() {
    for (const code of ["knowledge-categories", "knowledge-articles"] as const) {
      this.registry.register({ code, table: code === "knowledge-categories" ? "knowledge_categories" : "knowledge_articles",
        columns: code === "knowledge-categories" ? categoryColumns : articleColumns,
        expressions: code === "knowledge-articles" ? { tags: knowledgeExpressions(code).tags! } : {},
        fields: tablePermissionFieldsFor(code), searchColumns: code === "knowledge-categories" ? ["name", "code", "description"] : ["title", "summary", "contentText"],
        buildSearch: code === "knowledge-articles" ? (search, actor, params) => knowledgeSearchClause(search, actor as KnowledgeActor, params) : undefined,
        printResolvers: code === "knowledge-articles" ? { categoryId: async (rows, actor) => {
          if (!actor) return new Map();
          const ids = [...new Set(rows.map((row) => String(row.categoryId ?? "")).filter(Boolean))];
          if (!ids.length) return new Map();
          const categories = await this.access.transaction(actor as KnowledgeActor, (manager) => manager.query(`SELECT id,name FROM knowledge_categories WHERE tenant_id=$1 AND id=ANY($2::uuid[])`, [actor.tenantId, ids]));
          const labels = new Map(categories.map((category: { id: string; name: string }) => [category.id, category.name]));
          return new Map(rows.map((row) => [String(row.id), labels.get(String(row.categoryId)) ?? ""]));
        } } : undefined,
        authorize: (actor) => assertKnowledgeAction(actor as KnowledgeActor, code, "read"),
        buildScope: async (actor, params, action = "read") => code === "knowledge-articles"
          ? this.access.clause(actor as KnowledgeActor, params, "manage", action)
          : knowledgeDataScope(actor as KnowledgeActor, code, action, params),
        runQuery: (sql, params) => this.access.transaction({ tenantId: String(params[0]), userId: null, permissions: [], username: "query", requestId: "query" }, (manager) => manager.query(sql, params))
      });
    }
  }
}
