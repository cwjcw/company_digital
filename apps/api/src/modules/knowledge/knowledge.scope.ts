import { ForbiddenException, Injectable } from "@nestjs/common";
import { createOrganizationMembershipIndex } from "@kdos/permissions";
import { DataSource, type EntityManager } from "typeorm";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import { knowledgeText } from "./knowledge.content";
import { knowledgeExpressions, type KnowledgeActor, type KnowledgeResource } from "./knowledge.types";

export function knowledgeAdministrator(actor: KnowledgeActor) { return actor.isSystemAdmin === true || actor.permissions.includes("*") || actor.moduleAdminCodes?.includes("knowledge") === true; }
export function canKnowledge(actor: KnowledgeActor, resource: KnowledgeResource, action: string) { return knowledgeAdministrator(actor) || actor.permissions.includes(`${resource}:*:${action}`); }
export function canKnowledgeField(actor: KnowledgeActor, resource: KnowledgeResource, field: string, action: "read" | "update") { return knowledgeAdministrator(actor) || actor.permissions.includes(`${resource}:${field}:${action}`); }
export function assertKnowledgeAction(actor: KnowledgeActor, resource: KnowledgeResource, action: string) { if (!canKnowledge(actor, resource, action)) throw new ForbiddenException("当前权限组不能执行此知识库操作"); }
export function assertKnowledgeFields(actor: KnowledgeActor, resource: KnowledgeResource, fields: string[], action: "read" | "update" = "update") {
  for (const field of fields) if (!canKnowledgeField(actor, resource, field, action)) throw new ForbiddenException(`字段 ${field} 没有${action === "read" ? "查看" : "编辑"}权限`);
}
export function canManageKnowledge(actor: KnowledgeActor) { return ["create", "update", "delete"].some((action) => canKnowledge(actor, "knowledge-articles", action)); }
export function knowledgeDataScope(actor: KnowledgeActor, resource: KnowledgeResource, action: string, params: unknown[], expressions = knowledgeExpressions(resource)) {
  if (knowledgeAdministrator(actor)) return "1=1";
  // The legacy helper has a Planning-admin shortcut; it must not grant Knowledge authority.
  return buildDataScopeClause({ resource, action, columns: expressions, actor: { ...actor, moduleAdminCodes: [] }, params, expression: (column) => column, memberArrayFields: [] });
}
export function knowledgeSearchClause(search: unknown, actor: KnowledgeActor, params: unknown[], mode: "browse" | "manage" = "manage") {
  const text = knowledgeText(search, "搜索词", 200);
  if (!text) return "1=1";
  assertKnowledgeFields(actor, "knowledge-articles", ["title", "summary", "contentText", "tags"], "read");
  const keyword = text.replace(/[\\%_]/g, (value) => `\\${value}`);
  const index = params.push(`%${keyword}%`);
  return `${mode === "browse" ? "published" : "record"}.search_text ILIKE $${index}`;
}
export type KnowledgeMembership = { userId: string | null; organizationIds: string[]; roleIds: string[] };
export function knowledgeAclClause(expression: string, membership: KnowledgeMembership, params: unknown[]) {
  const userIndex = params.push(membership.userId); const orgIndex = params.push(membership.organizationIds); const roleIndex = params.push(membership.roleIds);
  return `(${expression}->>'type'='ALL' OR (${expression}->>'type'='USER' AND ${expression}->'subjectIds' ? $${userIndex}::text)
    OR (${expression}->>'type'='ORGANIZATION' AND ${expression}->'subjectIds' ?| $${orgIndex}::text[])
    OR (${expression}->>'type'='ROLE' AND ${expression}->'subjectIds' ?| $${roleIndex}::text[]))`;
}

/** One server authorization boundary for lists, search, detail, versions, files and platform sources. */
@Injectable()
export class KnowledgeAccessService {
  constructor(private readonly dataSource: DataSource) {}
  transaction<T>(actor: KnowledgeActor, work: (manager: EntityManager) => Promise<T>) {
    return this.dataSource.transaction(async (manager) => { await manager.query("SELECT set_config('app.tenant_id',$1,true)", [actor.tenantId]); return work(manager); });
  }
  async membership(actor: KnowledgeActor, manager: Pick<EntityManager, "query"> = this.dataSource.manager): Promise<KnowledgeMembership> {
    if (!actor.userId) return { userId: null, organizationIds: [], roleIds: [] };
    // A transaction owns one PostgreSQL connection; run its queries sequentially.
    const users = await manager.query(`SELECT department_paths AS paths FROM users WHERE id=$1 AND enabled=true`, [actor.userId]);
    const units = await manager.query(`SELECT id,name,parent_id AS "parentId" FROM organization_units WHERE enabled=true`);
    const bindings = await manager.query(`SELECT link.role_id AS id FROM user_roles link JOIN roles role ON role.id=link.role_id WHERE link.user_id=$1 AND role.permission_group_resource IS NULL`, [actor.userId]);
    const organizationRoles = await manager.query(`SELECT scope.role_id AS id,scope.organization_unit_id AS "organizationId" FROM role_organization_scopes scope JOIN roles role ON role.id=scope.role_id WHERE role.permission_group_resource IS NULL`);
    const membership = createOrganizationMembershipIndex(units);
    const paths = (users[0]?.paths ?? []) as string[][];
    const organizationIds = units.filter((unit: { id: string }) => paths.some((path) => membership.departmentPathBelongsTo(path, unit.id))).map((unit: { id: string }) => unit.id);
    return { userId: users.length ? actor.userId : null, organizationIds, roleIds: [...new Set<string>([...bindings.map((row: { id: string }) => row.id), ...organizationRoles.filter((row: { organizationId: string }) => organizationIds.includes(row.organizationId)).map((row: { id: string }) => row.id)])] };
  }
  async clause(actor: KnowledgeActor, params: unknown[], mode: "browse" | "manage", action = "read", manager?: EntityManager) {
    assertKnowledgeAction(actor, "knowledge-articles", action);
    if (mode === "manage" && !canManageKnowledge(actor)) throw new ForbiddenException("当前权限组没有文章管理权限");
    const clauses = ["record.tenant_id=$1", "record.deleted_at IS NULL", knowledgeDataScope(actor, "knowledge-articles", action, params, knowledgeExpressions("knowledge-articles", mode))];
    if (action === "export") clauses.push(knowledgeDataScope(actor, "knowledge-articles", "read", params));
    if (mode === "browse") clauses.push("record.status='PUBLISHED'", "published.version_no=record.published_version", `EXISTS(SELECT 1 FROM knowledge_categories category LEFT JOIN knowledge_categories parent ON parent.tenant_id=category.tenant_id AND parent.id=category.parent_id WHERE category.tenant_id=record.tenant_id AND category.id=published.category_id AND category.enabled=true AND COALESCE(parent.enabled,true))`);
    if (!knowledgeAdministrator(actor)) clauses.push(knowledgeAclClause(mode === "browse" ? "published.visibility" : "record.visibility", await this.membership(actor, manager), params));
    return clauses.map((clause) => `(${clause})`).join(" AND ");
  }
  async historicalClause(actor: KnowledgeActor, params: unknown[], manager: EntityManager) {
    if (knowledgeAdministrator(actor)) return "1=1";
    const membership = await this.membership(actor, manager);
    const historical = knowledgeAclClause("historical.visibility", membership, params);
    const current = (await this.clause(actor, params, "browse", "read", manager)).replace(/\brecord\./g, "current_article.").replace(/\bpublished\./g, "current_published.");
    return `(${historical}) AND EXISTS(SELECT 1 FROM knowledge_articles current_article JOIN knowledge_article_versions current_published ON current_published.tenant_id=current_article.tenant_id AND current_published.article_id=current_article.id AND current_published.version_no=current_article.published_version WHERE current_article.tenant_id=historical.tenant_id AND current_article.id=historical.article_id AND (${current}))`;

  }
}
