import { BadRequestException, Injectable } from "@nestjs/common";
import { OrderSyncRepository } from "./order-sync.repository";
import { FormalProjectionRepository } from "./formal-projection.repository";
import type { CommitSyncBatch, ConfigureProjectionConsumer, StartSyncRun, SyncActor } from "./order-sync.types";

const recordTypes = new Set(["ORDER_HEADER","ORDER_LINE","DELIVERY_PLAN","OUTBOUND_LINE","INBOUND_LINE","INVENTORY"]);

@Injectable()
export class OrderSyncApplicationService {
  constructor(private readonly repository: OrderSyncRepository, private readonly formalProjection: FormalProjectionRepository) {}

  start(input: StartSyncRun, actor: SyncActor) {
    if (!input?.sourceKey || !input.sourceSystem || !input.sourceDatabase || !input.sourceAccountName) throw new BadRequestException("来源配置不完整");
    if (!input.fieldMapping?.businessDate || !input.fieldMapping?.modifiedAt || !input.fieldMapping?.primaryKey) throw new BadRequestException("必须明确业务日期、修改时间和主键字段映射");
    return this.repository.startRun(input, actor);
  }

  commit(input: CommitSyncBatch, actor: SyncActor) {
    if (!input?.idempotencyKey || input.idempotencyKey.length > 200) throw new BadRequestException("批次幂等键无效");
    if (!Array.isArray(input.records) || input.records.length > 1000) throw new BadRequestException("每批最多1000条");
    if (input.batchFull !== (input.records.length === 1000)) throw new BadRequestException("batchFull必须与实际记录数一致");
    for (const row of input.records) {
      if (!row.sourceSystem || !row.sourceDatabase || !row.sourceTable || !row.sourceId || !row.contentHash) throw new BadRequestException("记录缺少来源幂等字段");
      if (row.sourceTable !== input.sourceTable) throw new BadRequestException("批次中混入其他来源表");
    }
    if (input.phase === "INCREMENTAL" && input.records.length) {
      for (let index = 1; index < input.records.length; index++) {
        const previous = input.records[index - 1]!;
        const current = input.records[index]!;
        if (!previous.modifiedAt || !current.modifiedAt || current.modifiedAt < previous.modifiedAt) {
          throw new BadRequestException("增量记录必须按修改时间＋源库主键确定性排序");
        }
        if (current.modifiedAt === previous.modifiedAt && current.sourceId === previous.sourceId) {
          throw new BadRequestException("同一修改时间下源主键不得重复");
        }
      }
      const last = input.records.at(-1)!;
      if (input.batchFull && (input.cursorAfter?.modifiedAt !== last.modifiedAt || String(input.cursorAfter?.sourcePk) !== last.sourceId)) throw new BadRequestException("满批时游标必须停在最后一条实际处理记录");
    }
    return this.repository.commitBatch(input, actor);
  }

  complete(runId: string, sourceKey: string, metrics: unknown, actor: SyncActor) {
    return this.repository.completeRun(runId, sourceKey, metrics, actor);
  }

  fail(runId: string, sourceKey: string, errorMessage: string, retryCount: number, actor: SyncActor) {
    if (!sourceKey || !errorMessage || !Number.isInteger(retryCount) || retryCount < 0) throw new BadRequestException("失败记录参数无效");
    return this.repository.failRun(runId,sourceKey,errorMessage,retryCount,actor);
  }

  configureProjection(consumerKey: string, input: ConfigureProjectionConsumer, actor: SyncActor) {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(consumerKey) || !/^[a-z0-9][a-z0-9-_]{2,99}$/.test(input?.targetResource ?? "")) {
      throw new BadRequestException("投影订阅标识或目标资源无效");
    }
    const types = [...new Set(input.recordTypes ?? [])];
    if (!types.length || types.some((value) => !recordTypes.has(value))) throw new BadRequestException("投影记录类型无效");
    const batchSize = input.batchSize ?? 1000;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new BadRequestException("投影批次必须为1至1000条");
    if (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1)) throw new BadRequestException("投影版本无效");
    return this.repository.configureProjectionConsumer(consumerKey, { ...input, recordTypes: types, batchSize }, actor);
  }

  claimProjection(consumerKey: string, actor: SyncActor) {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(consumerKey)) throw new BadRequestException("投影订阅标识无效");
    return this.repository.claimProjectionBatch(consumerKey, actor);
  }

  completeProjection(consumerKey: string, leaseToken: string, actor: SyncActor) {
    if (!leaseToken) throw new BadRequestException("投影租约不能为空");
    return this.repository.completeProjectionBatch(consumerKey, leaseToken, actor);
  }

  failProjection(consumerKey: string, leaseToken: string, errorMessage: string, actor: SyncActor) {
    if (!leaseToken || !errorMessage) throw new BadRequestException("投影失败参数不完整");
    return this.repository.failProjectionBatch(consumerKey, leaseToken, errorMessage, actor);
  }

  initializeFormalProjections(actor: SyncActor) {
    return this.formalProjection.initialize(actor);
  }

  async projectFormalBatch(consumerKey: string, actor: SyncActor) {
    if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(consumerKey)) throw new BadRequestException("投影订阅标识无效");
    const claimed = await this.repository.claimProjectionBatch(consumerKey, actor);
    if (!claimed.leaseToken || !claimed.records.length) return { consumerKey, processed: 0, drained: true };
    try {
      const result = await this.formalProjection.apply(consumerKey, claimed.records, actor);
      await this.repository.completeProjectionBatch(consumerKey, claimed.leaseToken, actor);
      return { consumerKey, processed: claimed.records.length, drained: claimed.records.length < 1000, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.failProjectionBatch(consumerKey, claimed.leaseToken, message, actor);
      throw error;
    }
  }
}
