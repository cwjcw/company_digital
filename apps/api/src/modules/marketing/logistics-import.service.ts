import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import ExcelJS from 'exceljs';
import * as XLSX from '@e965/xlsx';
import Decimal from 'decimal.js';
import { logisticsBusinessFields, logisticsMasterKeys, logisticsDetailKeys, logisticsFeeKeys, type LogisticsValues, type LogisticsShipment, type LogisticsImportError, type LogisticsImportPreview } from '@kdos/contracts';
import { assertSpreadsheetNotEncrypted } from '../../spreadsheet-upload';
import { LogisticsApplicationService, normalizeLogisticsValues } from './logistics.application.service';
import { LogisticsDirectoryQueryService } from './logistics-directory.query.service';
import { logisticsField, type LogisticsActor } from './logistics.policy';
@Injectable()
export class LogisticsImportService {
  constructor(private readonly application: LogisticsApplicationService, private readonly directory: LogisticsDirectoryQueryService) {}
  private signature(text: string) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new BadRequestException('导入签名配置缺失');
    return createHmac('sha256', secret).update(text).digest('hex');
  }
  async template(actor: LogisticsActor) {
    this.application.assertAction(actor, 'import');
    const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('物流台账');
    sheet.columns = logisticsBusinessFields.map(f => ({ header: f.label, key: f.key, width: 22, style: { numFmt: '@' } }));
    const notes = wb.addWorksheet('填写说明'); notes.getColumn(1).width = 130;
    notes.addRows([
      ['原17列保持不变，右侧增加6列；物流单号必填且按文本填写，保留前导零；其余新增字段可空。'],
      ['相同物流单号合并为一柜，整柜字段可只填首行，也可重复相同值；不同值会报冲突，不会覆盖。'],
      ['客户填写现有营销客户编码；物流负责人填写登录名、用户ID或唯一姓名，重名请使用登录名。出运日期填写YYYY-MM-DD。'],
      ['数量、装箱量（PCS/箱）、净重和毛重（单箱重量）按原值保存；费用合计自动计算，无需填写。'],
      ['整文件校验通过后才能确认；已存在物流单号不能重复导入。网页修改走记录版本校验。'],
      ['费用按整柜统计，按订单查看不代表订单独立发生全部整柜费用，本期不分摊。'],
      ['本业务导入为新增适配，不按物流单号猜测更新；模板严格23列，不增加记录ID/版本业务列。导出重导存在的物流单号将明确拒绝。']
    ]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  async preview(file: Express.Multer.File, actor: LogisticsActor): Promise<LogisticsImportPreview> {
    this.application.assertAction(actor, 'import'); this.application.assertAction(actor, 'create');
    if (!file?.buffer?.length) throw new BadRequestException('请选择Excel文件');
    assertSpreadsheetNotEncrypted(file.buffer);
    if (!/\.xlsx?$/i.test(file.originalname) || file.buffer.length > 20 * 1024 * 1024) throw new BadRequestException('请选择不超过20MB的.xls或.xlsx文件');
    let book: XLSX.WorkBook;
    try { book = XLSX.read(file.buffer, { type: 'buffer', cellDates: false, cellNF: true, sheetRows: 10007 }); }
    catch { throw new BadRequestException('Excel文件损坏或格式不正确'); }
    let sheet: XLSX.WorkSheet | undefined, headerRow = -1, headers = new Map<string, number>();
    for (const name of book.SheetNames) {
      const candidate = book.Sheets[name]!;
      for (let row = 0; row < 5; row++) {
        const map = new Map<string, number>();
        for (let col = 0; col < 80; col++) {
          const text = String(candidate[XLSX.utils.encode_cell({ r: row, c: col })]?.v ?? '').trim();
          if (text) {
            if (map.has(text) && logisticsBusinessFields.some(f => f.label === text)) throw new BadRequestException(`第${row + 1}行表头重复：${text}`);
            map.set(text, col);
          }
        }
        if (map.has('款号') && map.has('物流单号')) { sheet = candidate; headers = map; headerRow = row; break; }
      }
      if (sheet) break;
    }
    if (!sheet) throw new BadRequestException('前5行未找到物流台账表头，请使用23列模板');
    const missing = logisticsBusinessFields.filter(f => !headers.has(f.label));
    if (missing.length) throw new BadRequestException(`缺少表头：${missing.map(f => f.label).join('、')}`);
    const range = XLSX.utils.decode_range(String(sheet['!fullref'] ?? sheet['!ref'] ?? 'A1'));
    if (range.e.r - headerRow > 10000) throw new BadRequestException('单次最多导入10000条明细');
    const refs = await this.directory.references(actor.tenantId);
    const errors: LogisticsImportError[] = [], rows: Array<{ row: number; values: LogisticsValues }> = [];
    const groups = new Map<string, { shipment: LogisticsShipment; source: Map<string, Array<{ row: number; value: string }>>; fingerprints: Map<string, number> }>();
    const addError = (row: number, field: string, reason: string) => errors.push({ row, field, reason });
    for (let r = headerRow + 1; r <= range.e.r; r++) {
      const raw: LogisticsValues = {};
      if (!logisticsBusinessFields.some(f => f.key !== 'totalFee' && sheet![XLSX.utils.encode_cell({ r, c: headers.get(f.label)! })]?.v != null)) continue;
      for (const f of logisticsBusinessFields) {
        if (f.key === 'totalFee') continue;
        const cell = sheet[XLSX.utils.encode_cell({ r, c: headers.get(f.label)! })] as XLSX.CellObject | undefined;
        if (cell && (cell.t === 'e' || (cell.f && cell.v == null))) { addError(r + 1, f.label, '公式缺少有效结果或单元格包含错误'); continue; }
        if (!cell || cell.v == null || cell.v === '') { raw[f.key] = null; continue; }
        if (f.type === 'date' && typeof cell.v === 'number') {
          const date = XLSX.SSF.parse_date_code(cell.v, { date1904: book.Workbook?.WBProps?.date1904 });
          raw[f.key] = date ? `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}` : String(cell.v);
        } else raw[f.key] = f.type === 'number' ? String(cell.v) : typeof cell.v === 'string' ? cell.v : XLSX.utils.format_cell(cell);
        if (f.key === 'ownerUserId' && raw[f.key]) {
          const text = raw[f.key]!.trim();
          let found = refs.members.filter(u => u.id === text || u.username === text || (u.employeeNo && u.employeeNo === text) || `${u.displayName} (${u.username})` === text);
          if (!found.length) found = refs.members.filter(u => u.displayName === text);
          if (found.length !== 1) addError(r + 1, f.label, found.length ? `用户“${text}”存在歧义，请填写登录名或用户ID` : `未找到有效用户“${text}”`);
          else raw[f.key] = found[0]!.id;
        }
        if (f.key === 'customerCode' && raw[f.key] && !refs.customers.some(c => c.code === raw[f.key])) addError(r + 1, f.label, `未匹配现有客户编码“${raw[f.key]}”`);
        try { Object.assign(raw, normalizeLogisticsValues({ [f.key]: raw[f.key] }, true)); }
        catch (e) { addError(r + 1, f.label, (e as Error).message); }
        if (raw[f.key] != null && !logisticsField(actor, f.key, 'update')) addError(r + 1, f.label, '当前用户没有该字段填写权限');
      }
      if (!raw.logisticsNumber?.trim()) { addError(r + 1, '物流单号', '不能为空'); rows.push({ row: r + 1, values: raw }); continue; }
      rows.push({ row: r + 1, values: { ...raw } });
      let group = groups.get(raw.logisticsNumber);
      if (!group) { group = { shipment: { master: {}, details: [] }, source: new Map(), fingerprints: new Map() }; groups.set(raw.logisticsNumber, group); }
      for (const key of logisticsMasterKeys) {
        const value = raw[key]; if (value == null || value === '') continue;
        const source = group.source.get(key) ?? []; source.push({ row: r + 1, value }); group.source.set(key, source);
        const previous = group.shipment.master[key];
        const same = previous == null || (logisticsFeeKeys.includes(key as typeof logisticsFeeKeys[number]) && /^-?\d+(\.\d+)?$/.test(previous) && /^-?\d+(\.\d+)?$/.test(value) ? previous == null || new Decimal(previous).eq(value) : previous === value);
        if (!same) errors.push({ row: r + 1, field: logisticsBusinessFields.find(f => f.key === key)!.label, reason: `物流单号“${raw.logisticsNumber}”整柜字段冲突`, values: [...source] });
        else if (previous == null) group.shipment.master[key] = value;
      }
      const detail = Object.fromEntries(logisticsDetailKeys.map(k => [k, raw[k] ?? null]));
      const fingerprint = JSON.stringify(logisticsDetailKeys.filter(k => k !== 'sequence').map(k => detail[k]));
      if (group.fingerprints.has(fingerprint)) addError(r + 1, '款号明细', `疑似重复明细，与第${group.fingerprints.get(fingerprint)}行相同，请核对后修改文件`);
      else group.fingerprints.set(fingerprint, r + 1);
      group.shipment.details.push(detail);
    }
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.application.existing([...groups.keys()], actor, hash);
    if (existing.repeated) addError(headerRow + 2, '文件', '该文件已经导入，请勿重复上传');
    for (const row of rows) if (existing.numbers.includes(row.values.logisticsNumber!)) addError(row.row, '物流单号', '该物流单号已存在，不允许重复导入或静默覆盖');
    if (!rows.length) addError(headerRow + 2, '文件', '没有可导入的数据');
    const payload = Buffer.from(JSON.stringify({ tenant: actor.tenantId, user: actor.userId, expires: Date.now() + 30 * 60 * 1000, hash, shipments: [...groups.values()].map(g => g.shipment) })).toString('base64url');
    return { total: rows.length, shipments: groups.size, errors, rows: rows.slice(0, 50), token: errors.length ? null : `${payload}.${this.signature(payload)}` };
  }
  async confirm(token: unknown, actor: LogisticsActor) {
    this.application.assertAction(actor, 'import'); this.application.assertAction(actor, 'create');
    if (typeof token !== 'string' || token.length > 20 * 1024 * 1024) throw new BadRequestException('请重新上传并预览文件');
    const [payload, signed, extra] = token.split('.'); const signature = this.signature(payload ?? '');
    if (extra || !signed || signed.length !== signature.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(signed))) throw new BadRequestException('导入预览签名无效，请重新上传');
    let data: { tenant: string; user: string; expires: number; hash: string; shipments: LogisticsShipment[] };
    try { data = JSON.parse(Buffer.from(payload!, 'base64url').toString()); } catch { throw new BadRequestException('导入预览无效'); }
    if (data.tenant !== actor.tenantId || data.user !== actor.userId || !Number.isFinite(data.expires) || data.expires < Date.now()) throw new BadRequestException('导入预览已过期或不属于当前用户');
    return this.application.importCommands(data.shipments, `excel:${data.hash}`, data.hash, actor);
  }
}
