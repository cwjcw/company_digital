import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import type { KnowledgeActor } from "./knowledge.types";
import { KnowledgeQueryService } from "./knowledge.query.service";
import { KnowledgeApplicationService } from "./knowledge.application.service";
import { knowledgeAdministrator } from "./knowledge.scope";

export const KNOWLEDGE_CONVERTER_VERSION = "libreoffice-pdf-v1";
export const needsKnowledgeConversion = (type: string) =>
  /(?:msword|ms-excel|ms-powerpoint|officedocument)/.test(type);
@Injectable()
export class KnowledgePreviewJobs {
  constructor(private readonly source: DataSource) {}
  async transaction<T>(tenant: string, fn: (m: EntityManager) => Promise<T>) {
    return this.source.transaction(async (m) => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      return fn(m);
    });
  }
  async enqueue(
    m: EntityManager,
    tenant: string,
    file: { id: string; sha256: string; contentType: string },
  ) {
    if (!needsKnowledgeConversion(file.contentType)) return;
    await m.query(
      `INSERT INTO knowledge_file_previews(tenant_id,file_id,sha256,converter_version) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,file_id,sha256,converter_version) DO NOTHING`,
      [tenant, file.id, file.sha256, KNOWLEDGE_CONVERTER_VERSION],
    );
  }
  async claim(tenant: string, leaseSeconds: number) {
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 30 ||
      leaseSeconds > 1800
    )
      throw new Error("Invalid processing lease");
    return this.transaction(tenant, async (m) => {
      const [job] = await m.query(
        `SELECT job.*,asset.storage_key original_key,asset.original_name,asset.content_type FROM knowledge_file_previews job JOIN knowledge_file_assets asset ON asset.tenant_id=job.tenant_id AND asset.id=job.file_id AND asset.sha256=job.sha256
        WHERE job.tenant_id=$1 AND (job.status='PENDING' OR (job.status='RUNNING' AND job.lease_until<now())) ORDER BY job.created_at,job.id LIMIT 1 FOR UPDATE OF job SKIP LOCKED`,
        [tenant],
      );
      if (!job) return null;
      // Exhausted crash recovery remains visible as FAILED until an authorized explicit retry.
      if (job.attempts >= 3) {
        await m.query(
          "UPDATE knowledge_file_previews SET status='FAILED',error_reason='转换任务多次中断，请管理员重试',lease_id=NULL,lease_until=NULL,completed_at=now() WHERE tenant_id=$1 AND id=$2",
          [tenant, job.id],
        );
        return null;
      }
      if (job.storage_key)
        await m.query(
          "INSERT INTO knowledge_storage_cleanup(tenant_id,storage_key) VALUES($1,$2) ON CONFLICT(storage_key) DO NOTHING",
          [tenant, job.storage_key],
        );
      const leaseId = randomUUID(),
        key = `.private/knowledge-previews/${Buffer.from(tenant).toString("hex")}/${job.file_id}/${job.id}/${leaseId}.pdf`;
      await m.query(
        `UPDATE knowledge_file_previews SET status='RUNNING',attempts=attempts+1,error_reason=NULL,lease_id=$3,lease_until=now()+$4*interval '1 second',storage_key=$5,size=NULL,started_at=now(),completed_at=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2`,
        [tenant, job.id, leaseId, leaseSeconds, key],
      );
      return { ...job, leaseId, key };
    });
  }
  async complete(
    tenant: string,
    id: string,
    leaseId: string,
    outcome: { size?: number; error?: string },
  ) {
    return this.transaction(tenant, async (m) => {
      const rows = await m.query(
        `UPDATE knowledge_file_previews SET status=$4,size=$5,error_reason=$6,lease_id=NULL,lease_until=NULL,completed_at=now(),updated_at=now(),version=version+1
        WHERE tenant_id=$1 AND id=$2 AND lease_id=$3 AND status='RUNNING' AND lease_until>now() RETURNING id`,
        [
          tenant,
          id,
          leaseId,
          outcome.error ? "FAILED" : "SUCCEEDED",
          outcome.size ?? null,
          outcome.error?.slice(0, 1000) ?? null,
        ],
      );
      // TypeORM PostgreSQL UPDATE returns [returningRows, affectedCount].
      return Array.isArray(rows[0]) && rows[0].length === 1;
    });
  }
}
@Injectable()
export class KnowledgePreviewService {
  constructor(
    private readonly queries: KnowledgeQueryService,
    private readonly app: KnowledgeApplicationService,
  ) {}
  async status(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    const file = await this.queries.attachment(id, input, actor);
    if (!needsKnowledgeConversion(file.contentType))
      return {
        status: "SUCCEEDED",
        attempts: 0,
        error: null,
        originalName: file.originalName,
        contentType: file.contentType,
        native: true,
      };
    return this.app.accessTransaction(actor, async (m) => {
      const [job] = await m.query(
        `SELECT status,attempts,retry_count AS "retryCount",error_reason AS error,completed_at AS "completedAt" FROM knowledge_file_previews WHERE tenant_id=$1 AND file_id=$2 AND sha256=$3 AND converter_version=$4`,
        [actor.tenantId, id, file.sha256, KNOWLEDGE_CONVERTER_VERSION],
      );
      return {
        ...(job ?? { status: "PENDING", attempts: 0, error: null }),
        originalName: file.originalName,
        contentType: file.contentType,
        native: false,
      };
    });
  }
  async preview(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    const file = await this.queries.attachment(id, input, actor);
    if (!needsKnowledgeConversion(file.contentType)) return file;
    return this.app.accessTransaction(actor, async (m) => {
      const [job] = await m.query(
        `SELECT storage_key AS key,size FROM knowledge_file_previews WHERE tenant_id=$1 AND file_id=$2 AND sha256=$3 AND converter_version=$4 AND status='SUCCEEDED'`,
        [actor.tenantId, id, file.sha256, KNOWLEDGE_CONVERTER_VERSION],
      );
      if (!job)
        throw new NotFoundException(
          "在线预览尚未生成，请查看处理状态或下载原件",
        );
      return {
        ...file,
        ...job,
        contentType: "application/pdf",
        originalName: file.originalName.replace(/\.[^.]+$/, ".pdf"),
      };
    });
  }
  async retry(
    id: string,
    input: Record<string, unknown>,
    actor: KnowledgeActor,
  ) {
    if (!knowledgeAdministrator(actor))
      throw new BadRequestException("仅知识库管理员可以重试预览转换");
    const file = await this.queries.attachment(id, input, actor);
    return this.app.command(actor, async (m) => {
      const [job] = await m.query(
        "SELECT * FROM knowledge_file_previews WHERE tenant_id=$1 AND file_id=$2 AND sha256=$3 AND converter_version=$4 FOR UPDATE",
        [actor.tenantId, id, file.sha256, KNOWLEDGE_CONVERTER_VERSION],
      );
      if (!job) throw new BadRequestException("该文件无需转换或转换任务不存在");
      if (job.status !== "FAILED")
        throw new BadRequestException("仅失败任务可以重试");
      if (job.storage_key)
        await this.app.enqueueCleanup(m, [job.storage_key], actor);
      await m.query(
        "UPDATE knowledge_file_previews SET status='PENDING',attempts=0,retry_count=retry_count+1,error_reason=NULL,storage_key=NULL,size=NULL,lease_id=NULL,lease_until=NULL,completed_at=NULL,updated_at=now(),version=version+1 WHERE tenant_id=$1 AND id=$2",
        [actor.tenantId, job.id],
      );
      await this.app.audit(
        m,
        actor,
        "knowledge-pages",
        file.pageId,
        "file.preview_retried",
        {
          fileId: id,
          sha256: file.sha256,
          converterVersion: KNOWLEDGE_CONVERTER_VERSION,
        },
      );
      return { status: "PENDING" };
    });
  }
}
