import { ForbiddenException, Injectable } from "@nestjs/common";
import { createOrganizationMembershipIndex } from "@kdos/permissions";
import type { KnowledgeAccessEntry } from "@kdos/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { buildDataScopeClause } from "../../common/filtering/data-scope";
import {
  knowledgeExpressions,
  type KnowledgeActor,
  type KnowledgeMode,
  type KnowledgeResource,
} from "./knowledge.types";

export const knowledgeAdministrator = (actor: KnowledgeActor) =>
  actor.isSystemAdmin === true ||
  actor.permissions.includes("*") ||
  actor.moduleAdminCodes?.includes("knowledge") === true;
export const canKnowledge = (
  actor: KnowledgeActor,
  resource: KnowledgeResource,
  action: string,
) =>
  knowledgeAdministrator(actor) ||
  actor.permissions.includes(`${resource}:*:${action}`);
export const canKnowledgeField = (
  actor: KnowledgeActor,
  resource: KnowledgeResource,
  field: string,
  action: "read" | "update",
) =>
  knowledgeAdministrator(actor) ||
  actor.permissions.includes(`${resource}:${field}:${action}`);
export function assertKnowledgeAction(
  actor: KnowledgeActor,
  resource: KnowledgeResource,
  action: string,
) {
  if (!canKnowledge(actor, resource, action))
    throw new ForbiddenException("当前权限组不能执行此知识库操作");
}
export function assertKnowledgeFields(
  actor: KnowledgeActor,
  resource: KnowledgeResource,
  fields: string[],
  action: "read" | "update" = "update",
) {
  for (const field of fields)
    if (!canKnowledgeField(actor, resource, field, action))
      throw new ForbiddenException(
        `字段 ${field} 没有${action === "read" ? "查看" : "编辑"}权限`,
      );
}
export function knowledgeDataScope(
  actor: KnowledgeActor,
  resource: KnowledgeResource,
  action: string,
  params: unknown[],
  expressions = knowledgeExpressions(resource),
) {
  return knowledgeAdministrator(actor)
    ? "1=1"
    : buildDataScopeClause({
        resource,
        action,
        columns: expressions,
        actor: { ...actor, moduleAdminCodes: [] },
        params,
        expression: (column) => column,
      }).replace(
        /\brecord\.created_by\b/g,
        expressions.createdBy ?? "record.created_by",
      );
}
export type KnowledgeMembership = {
  userId: string | null;
  organizationIds: string[];
  roleIds: string[];
};
export const accessRank = (level: string) =>
  ({ VIEWER: 1, EDITOR: 2, FULL_ACCESS: 3 })[level] ?? 0;
export function effectiveKnowledgeRank(
  space: KnowledgeAccessEntry[],
  restrictions: KnowledgeAccessEntry[][],
  membership: KnowledgeMembership,
) {
  const rank = (entries: KnowledgeAccessEntry[]) =>
    Math.max(
      0,
      ...entries
        .filter(
          (e) =>
            e.subjectType === "ALL" ||
            (e.subjectType === "USER" && e.subjectId === membership.userId) ||
            (e.subjectType === "ORGANIZATION" &&
              membership.organizationIds.includes(e.subjectId ?? "")) ||
            (e.subjectType === "ROLE" &&
              membership.roleIds.includes(e.subjectId ?? "")),
        )
        .map((e) => accessRank(e.accessLevel)),
    );
  return Math.min(rank(space), ...restrictions.map(rank));
}
/** The single tenant/platform/Space/ancestor/status boundary, also used by platform candidates and exports. */
@Injectable()
export class KnowledgeAuthorizationService {
  constructor(private readonly dataSource: DataSource) {}
  transaction<T>(
    actor: KnowledgeActor,
    work: (manager: EntityManager) => Promise<T>,
  ) {
    return this.dataSource.transaction(async (m) => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)", [
        actor.tenantId,
      ]);
      return work(m);
    });
  }
  async membership(
    actor: KnowledgeActor,
    manager: Pick<EntityManager, "query"> = this.dataSource.manager,
  ): Promise<KnowledgeMembership> {
    if (!actor.userId || knowledgeAdministrator(actor))
      return { userId: actor.userId, organizationIds: [], roleIds: [] };
    const users = await manager.query(
      "SELECT department_paths AS paths FROM users WHERE id=$1 AND enabled=true",
      [actor.userId],
    );
    const units = await manager.query(
      'SELECT id,name,parent_id AS "parentId" FROM organization_units WHERE enabled=true',
    );
    const direct = await manager.query(
      "SELECT link.role_id id FROM user_roles link JOIN roles role ON role.id=link.role_id WHERE link.user_id=$1 AND role.permission_group_resource IS NULL",
      [actor.userId],
    );
    const linked = await manager.query(
      'SELECT scope.role_id id,scope.organization_unit_id AS "organizationId" FROM role_organization_scopes scope JOIN roles role ON role.id=scope.role_id WHERE role.permission_group_resource IS NULL',
    );
    const index = createOrganizationMembershipIndex(units);
    const organizationIds = units
      .filter((u: { id: string }) =>
        (users[0]?.paths ?? []).some((path: string[]) =>
          index.departmentPathBelongsTo(path, u.id),
        ),
      )
      .map((u: { id: string }) => u.id);
    return {
      userId: users.length ? actor.userId : null,
      organizationIds,
      roleIds: [
        ...new Set<string>([
          ...direct.map((r: { id: string }) => r.id),
          ...linked
            .filter((r: { organizationId: string }) =>
              organizationIds.includes(r.organizationId),
            )
            .map((r: { id: string }) => r.id),
        ]),
      ],
    };
  }
  matches(
    alias: string,
    membership: KnowledgeMembership,
    params: unknown[],
    json = false,
  ) {
    const user = params.push(membership.userId),
      org = params.push(membership.organizationIds),
      roles = params.push(membership.roleIds);
    const type = json ? `${alias}->>'subjectType'` : `${alias}.subject_type`;
    const id = json ? `${alias}->>'subjectId'` : `${alias}.subject_id::text`;
    return `(${type}='ALL' OR (${type}='USER' AND ${id}=$${user}::text) OR (${type}='ORGANIZATION' AND ${id}=ANY($${org}::text[])) OR (${type}='ROLE' AND ${id}=ANY($${roles}::text[])))`;
  }
  async spaceClause(
    actor: KnowledgeActor,
    params: unknown[],
    action = "read",
    minimum = 1,
    manager?: EntityManager,
    alias = "record",
  ) {
    assertKnowledgeAction(actor, "knowledge-spaces", action);
    const expressions = Object.fromEntries(
      Object.entries(knowledgeExpressions("knowledge-spaces")).map(([k, v]) => [
        k,
        v.replace(/record\./g, `${alias}.`),
      ]),
    );
    const scope = knowledgeDataScope(
      actor,
      "knowledge-spaces",
      action,
      params,
      expressions,
    );
    const membership = await this.membership(actor, manager);
    const rank = this.spaceRank(actor, membership, params, alias);
    return `${alias}.tenant_id=$1 AND (${scope}) AND (${rank})>=${minimum}`;
  }
  spaceRank(
    actor: KnowledgeActor,
    membership: KnowledgeMembership,
    params: unknown[],
    alias = "record",
  ) {
    if (knowledgeAdministrator(actor)) return "3";
    return `(SELECT COALESCE(max(CASE acl.access_level WHEN 'FULL_ACCESS' THEN 3 WHEN 'EDITOR' THEN 2 ELSE 1 END),0) FROM knowledge_space_access acl WHERE acl.tenant_id=${alias}.tenant_id AND acl.space_id=${alias}.id AND ${this.matches("acl", membership, params)})`;
  }
  chain(alias = "record") {
    return `WITH RECURSIVE chain AS (
    SELECT id,parent_id,space_id,tenant_id,status,published_version_id,access_restricted,ARRAY[id] visited FROM knowledge_pages WHERE tenant_id=${alias}.tenant_id AND id=${alias}.id
    UNION ALL SELECT p.id,p.parent_id,p.space_id,p.tenant_id,p.status,p.published_version_id,p.access_restricted,c.visited||p.id
      FROM knowledge_pages p JOIN chain c ON p.id=c.parent_id AND p.tenant_id=c.tenant_id AND p.space_id=c.space_id WHERE NOT p.id=ANY(c.visited))`;
  }
  async clause(
    actor: KnowledgeActor,
    params: unknown[],
    mode: KnowledgeMode = "published",
    action = "read",
    minimum = mode === "trash"
      ? 3
      : mode === "working"
        ? 2
        : ["read", "export"].includes(action)
          ? 1
          : 2,
    manager?: EntityManager,
    expressions = knowledgeExpressions("knowledge-pages", mode),
  ) {
    assertKnowledgeAction(actor, "knowledge-pages", action);
    assertKnowledgeAction(actor, "knowledge-spaces", "read");
    if (mode === "working" && action === "read")
      assertKnowledgeAction(actor, "knowledge-pages", "update");
    const membership = await this.membership(actor, manager);
    const pageScope = knowledgeDataScope(
      actor,
      "knowledge-pages",
      action,
      params,
      expressions,
    );
    const spaceScope = knowledgeDataScope(
      actor,
      "knowledge-spaces",
      "read",
      params,
      Object.fromEntries(
        Object.entries(knowledgeExpressions("knowledge-spaces")).map(
          ([k, v]) => [k, v.replace(/record\./g, "space.")],
        ),
      ),
    );
    const rank = this.spaceRank(actor, membership, params, "space");
    const restriction = knowledgeAdministrator(actor)
      ? "false"
      : `chain.access_restricted AND NOT EXISTS(SELECT 1 FROM knowledge_page_access acl WHERE acl.tenant_id=chain.tenant_id AND acl.page_id=chain.id AND (CASE acl.access_level WHEN 'FULL_ACCESS' THEN 3 WHEN 'EDITOR' THEN 2 ELSE 1 END)>=${minimum} AND ${this.matches("acl", membership, params)})`;
    const state =
      mode === "published"
        ? "chain.status NOT IN ('PUBLISHED','ARCHIVED') OR chain.published_version_id IS NULL"
        : mode === "trash"
          ? "false"
          : "chain.status='TRASHED'";
    const ancestorExpressions = Object.fromEntries(
      Object.entries(knowledgeExpressions("knowledge-pages", mode)).map(
        ([key, value]) => [
          key,
          value
            .replace(/record\./g, "ancestor.")
            .replace(/published\./g, "ancestor_published."),
        ],
      ),
    );
    const ancestorScope = knowledgeDataScope(
      actor,
      "knowledge-pages",
      "read",
      params,
      ancestorExpressions,
    );
    let scope = `record.tenant_id=$1 AND (${pageScope}) AND EXISTS(SELECT 1 FROM knowledge_spaces space WHERE space.tenant_id=record.tenant_id AND space.id=record.space_id AND (${spaceScope}) AND (${rank})>=${minimum} ${mode === "trash" ? "" : "AND space.status='ACTIVE'"})
      AND NOT EXISTS(${this.chain()} SELECT 1 FROM chain JOIN knowledge_pages ancestor ON ancestor.tenant_id=chain.tenant_id AND ancestor.id=chain.id LEFT JOIN knowledge_page_versions ancestor_published ON ancestor_published.tenant_id=ancestor.tenant_id AND ancestor_published.id=ancestor.published_version_id WHERE (${restriction}) OR (${state}) OR NOT (${ancestorScope}))`;
    if (mode === "trash") scope += " AND record.status='TRASHED'";
    if (action === "export")
      scope += ` AND (${knowledgeDataScope(actor, "knowledge-pages", "read", params, expressions)})`;
    return scope;
  }
  ancestors(manager: EntityManager, id: string, actor: KnowledgeActor) {
    return manager.query(
      `SELECT ancestor.* FROM knowledge_pages record CROSS JOIN LATERAL (
      ${this.chain()} SELECT chain.*,p.title,v.title AS published_title FROM chain
      JOIN knowledge_pages p ON p.tenant_id=chain.tenant_id AND p.id=chain.id
      LEFT JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id
      ORDER BY cardinality(chain.visited) DESC) ancestor WHERE record.tenant_id=$1 AND record.id=$2`,
      [actor.tenantId, id],
    );
  }
  historicalClause(
    actor: KnowledgeActor,
    membership: KnowledgeMembership,
    params: unknown[],
    alias = "historical",
  ) {
    return knowledgeAdministrator(actor)
      ? "1=1"
      : `NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${alias}.access_snapshot) grouping(value) WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(grouping.value) entry(value) WHERE ${this.matches("entry.value", membership, params, true)}))`;
  }
}
