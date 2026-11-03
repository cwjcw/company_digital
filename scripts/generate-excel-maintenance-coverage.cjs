#!/usr/bin/env node
/* Generate the auditable Excel maintenance coverage workbook from the contracts registry. */
const ExcelJS = require(require.resolve('exceljs', { paths: [require('node:path').resolve(__dirname, '../apps/api')] }));
const contracts = require('../packages/contracts/dist/index.js');
const {
  tableResourceRegistry,
  tableExcelResourceCapabilities,
  tableFilterResourceCapabilities,
  tablePrintResourceCapabilities,
  auditTableExcelCapabilities
} = contracts;
const audit = auditTableExcelCapabilities();
const workbook = new ExcelJS.Workbook();
workbook.creator = 'KDOS 平台能力审计';
workbook.subject = 'Excel双向数据维护能力覆盖';
const summary = workbook.addWorksheet('汇总');
summary.columns = [{ header: '项目', key: 'name', width: 36 }, { header: '结果', key: 'value', width: 96 }];
summary.addRows([
  { name: '扫描时间', value: new Date().toISOString() },
  { name: '来源', value: 'packages/contracts tableResourceRegistry + tableExcelResourceCapabilities' },
  { name: '正式资源总数', value: audit.total },
  { name: '共享模板+ID/版本导入合同', value: audit.shared },
  { name: '需业务专用适配', value: audit.specialized },
  { name: '明确不适用', value: audit.notApplicable },
  { name: '待补能力声明/改造', value: audit.gaps },
  { name: '能力Registry完整性', value: audit.errors.length ? `FAIL: ${audit.errors.join('; ')}` : 'PASS：所有资源已登记且无未知resource' },
  { name: '注意', value: '此清单为代码合同扫描；SPECIALIZED与GAP不是人工端到端验收。特殊业务资源须保留专属权限、数据范围、来源身份、状态机和审计适配。' }
]);
summary.getRow(1).font = { bold: true };
const rows = workbook.addWorksheet('资源能力');
rows.columns = [
  { header: '所属模块', key: 'module', width: 20 },
  { header: 'resourceCode', key: 'code', width: 34 },
  { header: '资源名称', key: 'label', width: 30 },
  { header: '普通导出', key: 'normalExport', width: 34 },
  { header: '新增模板', key: 'createTemplate', width: 18 },
  { header: '更新模板', key: 'updateTemplate', width: 18 },
  { header: 'Excel新增', key: 'excelCreate', width: 18 },
  { header: 'Excel更新', key: 'excelUpdate', width: 18 },
  { header: 'ID+版本合同', key: 'identity', width: 22 },
  { header: '适配器状态', key: 'adapter', width: 26 },
  { header: '权限/业务约束及结论', key: 'reason', width: 86 }
];
for (const resource of tableResourceRegistry) {
  const capability = tableExcelResourceCapabilities[resource.code];
  const filterStatus = tableFilterResourceCapabilities[resource.code]?.status;
  const exportStatus = filterStatus === 'REGISTERED_AND_FILTERABLE'
    ? '平台统一导出候选（运行时仍校验权限）'
    : tablePrintResourceCapabilities[resource.code]?.status === 'NOT_APPLICABLE'
      ? '聚合/专用/不适用，须按业务表确认'
      : '需核对平台导出注册';
  rows.addRow({
    module: resource.module,
    code: resource.code,
    label: resource.label,
    normalExport: exportStatus,
    createTemplate: capability.createTemplate,
    updateTemplate: capability.updateTemplate,
    excelCreate: capability.excelCreate,
    excelUpdate: capability.excelUpdate,
    identity: capability.identityVersionContract,
    adapter: capability.status === 'SHARED_SUPPORTED' ? 'MasterPlanSpreadsheetService共享适配' : capability.status === 'SPECIALIZED' ? '业务专用流程；更新模板待逐项验证' : capability.status === 'NOT_APPLICABLE' ? '无写入适配（例外登记）' : '未登记可用适配器',
    reason: capability.reason ?? '能力合同已覆盖；仍须针对资源权限、字段可逆值、业务约束和确认写入完成专项验收。'
  });
}
rows.autoFilter = { from: 'A1', to: 'K1' };
rows.views = [{ state: 'frozen', ySplit: 1 }];
rows.getRow(1).font = { bold: true };
for (const row of rows.getRows(2, rows.rowCount - 1) ?? []) row.alignment = { vertical: 'top', wrapText: true };
const file = require('node:path').resolve(__dirname, '../outputs/KDOS_Excel双向维护能力覆盖清单_20261103.xlsx');
workbook.xlsx.writeFile(file).then(() => { console.log(file); console.log(JSON.stringify(audit)); }).catch((error) => { console.error(error); process.exitCode = 1; });
