import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';
import { logisticsBusinessFields, logisticsMasterKeys, logisticsDetailKeys, type LogisticsValues, type LogisticsShipment } from '@kdos/contracts';
import { LOGISTICS_REPOSITORY, type LogisticsRepository, type LogisticsSession } from './logistics.repository';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
import { logisticsAction, logisticsColumn, logisticsField, logisticsScope, type LogisticsActor } from './logistics.policy';
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const editable = logisticsBusinessFields.filter(f => f.editable);
export function logisticsDate(raw: unknown) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().replace(/[/.]/g, '-');
  const parts = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const date = parts ? `${parts[1]}-${parts[2]!.padStart(2, '0')}-${parts[3]!.padStart(2, '0')}` : '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!date || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new BadRequestException('出运日期无效，请填写YYYY-MM-DD');
  return date;
}
export function normalizeLogisticsValues(raw: unknown, partial = false): LogisticsValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('物流字段格式无效');
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!editable.some(f => f.key === key)) throw new BadRequestException(`字段不可写入：${key}`);
  const result: LogisticsValues = {};
  for (const f of editable) {
    if (partial && !Object.hasOwn(input, f.key)) continue;
    const value = input[f.key];
    if (value == null || value === '') { result[f.key] = null; continue; }
    if (f.type === 'number') {
      const text = String(value).trim();
      if (!/^-?\d+(\.\d+)?$/.test(text) || text.replace(/[^\d]/g, '').length > 38 || !new Decimal(text).isFinite()) throw new BadRequestException(`${f.label}必须是有效十进制数字（最多38位）`);
      result[f.key] = text; // No rounding, conversion, box or weight calculation.
    } else if (f.type === 'date') result[f.key] = logisticsDate(value);
    else {
      if (typeof value !== 'string') throw new BadRequestException(`${f.label}必须为文本`);
      if (value.length > 5000 || (f.key === 'logisticsNumber' && value.length > 200)) throw new BadRequestException(`${f.label}内容过长`);
      if (f.key === 'ownerUserId' && !uuid.test(value)) throw new BadRequestException('物流负责人ID无效');
      result[f.key] = value; // Preserve leading zeros and the original logistics business identifier.
    }
  }
  if ((!partial || Object.hasOwn(input, 'logisticsNumber')) && !result.logisticsNumber?.trim()) throw new BadRequestException('物流单号不能为空');
  return result;
}
@Injectable()
export class LogisticsApplicationService {
  constructor(@Inject(LOGISTICS_REPOSITORY) private readonly repository: LogisticsRepository, private readonly directory: LogisticsDirectoryQueryService) {}
  assertAction(actor: LogisticsActor, action: string) { if (!logisticsAction(actor, action)) throw new ForbiddenException(`没有物流台账${action}权限`); }
  private fields(values: LogisticsValues, actor: LogisticsActor, creating = false) {
    for (const [key, value] of Object.entries(values)) {
      if (creating && value == null) continue;
      if (!logisticsField(actor, key, 'update')) throw new ForbiddenException(`当前权限组不能填写${editable.find(f => f.key === key)?.label ?? key}`);
    }
  }
  async validateReferences(values: LogisticsValues, actor: LogisticsActor) {
    if (values.customerCode && !(await this.directory.customers(actor.tenantId)).some(c => c.code === values.customerCode)) throw new BadRequestException('客户编码未匹配现有营销客户，请检查编码或先维护业务客户对应表');
    if (values.ownerUserId && !(await this.directory.members(actor.tenantId)).some(u => u.id === values.ownerUserId)) throw new BadRequestException('物流负责人不是当前租户内有效用户');
  }
  private version(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 1) throw new BadRequestException('请提供有效记录版本'); return Number(value); }
  private id(value: string) { if (!uuid.test(value)) throw new BadRequestException('记录ID无效'); }
  private async scope(s: LogisticsSession, id: string, actor: LogisticsActor, action: string, allDetails = false) {
    const p: unknown[] = [actor.tenantId]; const condition = logisticsScope(actor, p, action); p.push(id);
    const rows = await s.query(`SELECT record.id FROM marketing.logistics_ledger_rows record WHERE ${allDetails ? 'record.shipment_id' : 'record.id'}=$${p.length}::uuid AND ${allDetails ? `NOT (${condition})` : condition}`, p);
    if (allDetails ? rows.length > 0 : rows.length === 0) throw new ForbiddenException('记录不在当前操作的数据权限范围内');
  }
  private async insert(s: LogisticsSession, tenant: string, shipment: LogisticsShipment, actor: LogisticsActor) {
    const keys = logisticsMasterKeys; const m = shipment.master;
    const [master] = await s.query(`INSERT INTO marketing.logistics_shipments(tenant_id,${keys.map(logisticsColumn)},created_by,updated_by) VALUES($1,${keys.map((_, i) => `$${i + 2}`).join(',')},$${keys.length + 2},$${keys.length + 2}) RETURNING id,version`, [tenant, ...keys.map(k => m[k] ?? null), actor.userId]);
    const ids: string[] = [];
    for (const detail of shipment.details) {
      const keys = logisticsDetailKeys;
      const [d] = await s.query(`INSERT INTO marketing.logistics_details(tenant_id,shipment_id,${keys.map(logisticsColumn)},created_by,updated_by) VALUES($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')},$${keys.length + 3},$${keys.length + 3}) RETURNING id`, [tenant, master!.id, ...keys.map(k => detail[k] ?? null), actor.userId]);
      ids.push(d!.id);
      await this.scope(s, d!.id, actor, 'create');
    }
    await s.audit(actor, 'logistics.created', master!.id, null, shipment);
    return { id: ids[0], version: master!.version, details: ids.length };
  }
  async create(raw: unknown, commandKey: unknown, actor: LogisticsActor) {
    this.assertAction(actor, 'create');
    const values = normalizeLogisticsValues(raw); this.fields(values, actor, true); await this.validateReferences(values, actor);
    return this.importCommands([{ master: values, details: [values] }], `manual:${this.commandKey(commandKey)}`, `manual:${String(commandKey)}:${createHash('sha256').update(JSON.stringify(values)).digest('hex')}`, actor, false);
  }
  private commandKey(key: unknown) { if (typeof key !== 'string' || !/^[a-zA-Z0-9:_-]{16,150}$/.test(key)) throw new BadRequestException('操作标识无效，请重新打开表单'); return key; }
  async existing(numbers: string[], actor: LogisticsActor, fileHash?: string) {
    this.assertAction(actor, 'import');
    return this.repository.transaction(actor.tenantId, async (s, tenant) => {
      const rows = await s.query('SELECT logistics_number FROM marketing.logistics_shipments WHERE tenant_id=$1 AND logistics_number=ANY($2::text[])', [tenant, numbers]);
      const repeated = fileHash ? (await s.query('SELECT id FROM marketing.logistics_imports WHERE tenant_id=$1 AND file_hash=$2', [tenant, fileHash])).length > 0 : false;
      return { numbers: rows.map(r => String(r.logistics_number)), repeated };
    });
  }
  async importCommands(shipments: LogisticsShipment[], key: string, hash: string, actor: LogisticsActor, imported = true) {
    this.assertAction(actor, 'create'); if (imported) this.assertAction(actor, 'import');
    if (!shipments.length || shipments.length > 10000) throw new BadRequestException('导入数量无效');
    // Recheck all command/field/reference permissions at confirm time, not just preview time.
    const refs = await this.directory.references(actor.tenantId);
    for (const x of shipments) {
      x.master = normalizeLogisticsValues(x.master); this.fields(x.master, actor, true);
      if (!x.details.length) throw new BadRequestException('物流单必须包含装柜明细');
      for (const d of x.details) this.fields(normalizeLogisticsValues({ ...d, logisticsNumber: x.master.logisticsNumber }), actor, true);
      if (x.master.customerCode && !refs.customers.some(c => c.code === x.master.customerCode)) throw new BadRequestException('客户编码不存在');
      if (x.master.ownerUserId && !refs.members.some(u => u.id === x.master.ownerUserId)) throw new BadRequestException('物流负责人无效或已停用');
    }
    return this.repository.transaction(actor.tenantId, async (s, tenant) => {
      await s.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${tenant}:logistics:${key}`]);
      const prior = (await s.query('SELECT result,file_hash,created_by FROM marketing.logistics_imports WHERE tenant_id=$1 AND command_key=$2', [tenant, key]))[0];
      if (prior) {
        if (prior.file_hash !== hash || prior.created_by !== actor.userId) throw new ConflictException('操作标识已使用');
        return { ...prior.result, repeated: true };
      }
      if ((await s.query('SELECT id FROM marketing.logistics_imports WHERE tenant_id=$1 AND file_hash=$2', [tenant, hash])).length) throw new ConflictException('该文件已导入，请勿重复上传');
      const saved = [];
      for (const shipment of shipments) saved.push(await this.insert(s, tenant, shipment, actor));
      const result = { shipments: saved.length, details: saved.reduce((n, r) => n + r.details, 0), id: saved[0]?.id, version: 1, repeated: false };
      await s.query('INSERT INTO marketing.logistics_imports(tenant_id,command_key,file_hash,result,created_by) VALUES($1,$2,$3,$4,$5)', [tenant, key, hash, JSON.stringify(result), actor.userId]);
      return result;
    });
  }
  async update(id: string, raw: unknown, expected: unknown, actor: LogisticsActor, addingDetail = false) {
    this.id(id); this.assertAction(actor, addingDetail ? 'create' : 'update'); const version = this.version(expected);
    const values = normalizeLogisticsValues(raw, true);
    if (!Object.keys(values).length) throw new BadRequestException('没有需要保存的字段');
    if (addingDetail && Object.keys(values).some(k => !logisticsDetailKeys.includes(k as typeof logisticsDetailKeys[number]))) throw new BadRequestException('新增款号只允许填写明细字段');
    this.fields(values, actor, addingDetail); await this.validateReferences(values, actor);
    return this.repository.transaction(actor.tenantId, async (s, tenant) => {
      const [before] = await s.query(`SELECT s.*,d.id detail_id,row_to_json(d) detail_before FROM marketing.logistics_shipments s JOIN marketing.logistics_details d ON d.shipment_id=s.id AND d.tenant_id=s.tenant_id WHERE d.id=$1 AND s.tenant_id=$2 FOR UPDATE OF s`, [id, tenant]);
      if (!before) throw new NotFoundException('物流记录不存在');
      await this.scope(s, id, actor, addingDetail ? 'create' : 'update');
      if (before.version !== version) throw new ConflictException('记录版本已变化，请刷新后重试');
      const masterKeys = Object.keys(values).filter(k => logisticsMasterKeys.includes(k as typeof logisticsMasterKeys[number]));
      if (masterKeys.length) await this.scope(s, before.id, actor, 'update', true);
      for (const [table, keys, rowId] of [['logistics_shipments', masterKeys, before.id], ['logistics_details', Object.keys(values).filter(k => !masterKeys.includes(k)), id]] as const) {
        if (!keys.length || addingDetail) continue;
        await s.query(`UPDATE marketing.${table} SET ${keys.map((k, i) => `${logisticsColumn(k)}=$${i + 3}`).join(',')},updated_at=now(),updated_by=$${keys.length + 3}${table === 'logistics_details' ? ',version=version+1' : ''} WHERE tenant_id=$1 AND id=$2`, [tenant, rowId, ...keys.map(k => values[k]), actor.userId]);
      }
      let detailId = id;
      if (addingDetail) {
        const k = logisticsDetailKeys; const [d] = await s.query(`INSERT INTO marketing.logistics_details(tenant_id,shipment_id,${k.map(logisticsColumn)},created_by,updated_by) VALUES($1,$2,${k.map((_, i) => `$${i + 3}`)},$${k.length + 3},$${k.length + 3}) RETURNING id`, [tenant, before.id, ...k.map(k => values[k] ?? null), actor.userId]); detailId = d!.id;
      }
      await s.query('UPDATE marketing.logistics_shipments SET version=version+1,updated_at=now(),updated_by=$3 WHERE tenant_id=$1 AND id=$2', [tenant, before.id, actor.userId]);
      await this.scope(s, detailId, actor, addingDetail ? 'create' : 'update');
      if (masterKeys.length) await this.scope(s, before.id, actor, 'update', true);
      await s.audit(actor, addingDetail ? 'logistics.detail.created' : 'logistics.updated', before.id, before, { detailId, values });
      return { id: detailId, version: version + 1 };
    });
  }
  async delete(rows: Array<{ id: string; expectedVersion: number }>, actor: LogisticsActor) {
    this.assertAction(actor, 'delete'); if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new BadRequestException('请选择1至1000条记录');
    rows.forEach(r => { this.id(r.id); this.version(r.expectedVersion); });
    return this.repository.transaction(actor.tenantId, async (s, tenant) => {
      const records = await s.query(`SELECT d.*,s.version master_version,row_to_json(s) master_before FROM marketing.logistics_details d JOIN marketing.logistics_shipments s ON s.id=d.shipment_id AND s.tenant_id=d.tenant_id WHERE d.tenant_id=$1 AND d.id=ANY($2::uuid[]) ORDER BY s.id,d.id FOR UPDATE OF s`, [tenant, rows.map(r => r.id)]);
      if (records.length !== rows.length) throw new NotFoundException('部分物流明细不存在');
      for (const r of records) {
        await this.scope(s, r.id, actor, 'delete');
        if (rows.find(x => x.id === r.id)!.expectedVersion !== r.master_version) throw new ConflictException('记录版本已变化，请刷新后重试');
      }
      await s.query('DELETE FROM marketing.logistics_details WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenant, rows.map(r => r.id)]);
      for (const master of new Set(records.map(r => r.shipment_id))) {
        const [remaining] = await s.query('SELECT count(*)::int n FROM marketing.logistics_details WHERE tenant_id=$1 AND shipment_id=$2', [tenant, master]);
        if (remaining!.n) await s.query('UPDATE marketing.logistics_shipments SET version=version+1,updated_at=now(),updated_by=$3 WHERE tenant_id=$1 AND id=$2', [tenant, master, actor.userId]);
        else await s.query('DELETE FROM marketing.logistics_shipments WHERE tenant_id=$1 AND id=$2', [tenant, master]);
        await s.audit(actor, 'logistics.deleted', master, records.filter(r => r.shipment_id === master), { remainingDetails: remaining!.n });
      }
      return { deleted: records.length };
    });
  }
}
