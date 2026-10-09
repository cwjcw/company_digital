import { Injectable, type OnModuleInit } from "@nestjs/common";
import { tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import {
  KnowledgeAuthorizationService,
  assertKnowledgeAction,
  assertKnowledgeFields,
} from "./knowledge.scope";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { spaceColumns, type KnowledgeActor } from "./knowledge.types";

@Injectable()
export class KnowledgeFilterSourceProvider implements OnModuleInit {
  constructor(
    private readonly registry: TableFilterRegistry,
    private readonly access: KnowledgeAuthorizationService,
    private readonly queries: KnowledgeQueryService,
  ) {}
  onModuleInit() {
    const pageColumns = {
      id: "id",
      version: "version",
      spaceId: "space_id",
      parentId: "parent_id",
      title: "title",
      slug: "slug",
      status: "status",
      sortOrder: "sort_order",
      contentMode: "content_mode",
      description: "description",
      content: "content",
      contentText: "content_text",
      tags: "tags",
      attachmentIds: "attachment_ids",
      publishedVersion: "published_version",
      publishedBy: "published_by",
      publishedAt: "published_at",
      createdBy: "created_by",
      createdAt: "created_at",
      updatedBy: "updated_by",
      updatedAt: "updated_at",
    };
    for (const code of ["knowledge-spaces", "knowledge-pages"] as const) {
      const columns = code === "knowledge-spaces" ? spaceColumns : pageColumns,
        expressions = Object.fromEntries(
          Object.entries(columns).map(([k, v]) => [k, `record.${v}`]),
        );
      this.registry.register({
        code,
        table:
          code === "knowledge-spaces"
            ? "knowledge_spaces"
            : "knowledge_page_read_model",
        columns,
        fields: tablePermissionFieldsFor(code),
        searchColumns:
          code === "knowledge-spaces"
            ? ["name", "code", "description"]
            : ["title", "contentText"],
        buildSearch:
          code === "knowledge-pages"
            ? (search, actor, params) => {
                assertKnowledgeFields(
                  actor as KnowledgeActor,
                  "knowledge-pages",
                  ["title", "contentText", "description", "attachmentIds", "tags", "parentId"],
                  "read",
                );
                assertKnowledgeFields(
                  actor as KnowledgeActor,
                  "knowledge-spaces",
                  ["name"],
                  "read",
                );
                return `record.search_text ILIKE $${params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)}`;
              }
            : undefined,
        authorize: (a) =>
          assertKnowledgeAction(a as KnowledgeActor, code, "read"),
        buildScope: (a, p, action = "read") =>
          code === "knowledge-spaces"
            ? this.access.spaceClause(a as KnowledgeActor, p, action)
            : this.access.clause(
                a as KnowledgeActor,
                p,
                "published",
                action,
                1,
                undefined,
                expressions,
              ),
        printRows:
          code === "knowledge-pages"
            ? (q) =>
                this.queries.list(
                  {
                    search: q.search,
                    filterGroup: q.filterGroup,
                    sortField: q.sortField,
                    sortOrder: q.sortOrder,
                    ids: q.ids,
                    page: q.page,
                    pageSize: q.pageSize,
                    mode: "published",
                  },
                  q.actor as KnowledgeActor,
                  q.action ?? "read",
                )
            : undefined,
        runQuery: (sql, params) =>
          this.access.transaction(
            {
              tenantId: String(params[0]),
              userId: null,
              permissions: [],
              username: "platform-query",
              requestId: "platform-query",
            },
            (m) => m.query(sql, params),
          ),
      });
    }
  }
}
