import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import ExcelJS from "exceljs";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { modificationContext } from "../../modification-audit";
import { EquipmentApplicationService } from "./equipment.application.service";
import { departmentAliases, divisionAliases, monitoringValue, shouldSkipEquipmentImport } from "./equipment-workbook-import.helpers";

type ImportError = {
  sourceSheetRow: number;
  division: string;
  usageDepartment: string;
  equipmentCode: string;
  equipmentName: string;
  message: string;
};

function cellText(cell: ExcelJS.Cell) { return cell.text.replace(/\s+/g, " ").trim(); }
function excelDate(value: ExcelJS.CellValue) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000)).toISOString().slice(0, 10);
  const text = String(value).trim(); const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

async function stdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "").trim() : "";
}

async function writeErrorReport(path: string, errors: ImportError[]) {
  if (!path) return;
  const report = new ExcelJS.Workbook();
  const sheet = report.addWorksheet("导入异常");
  sheet.columns = [
    { header: "源表行号", key: "sourceSheetRow", width: 12 },
    { header: "事业部", key: "division", width: 16 },
    { header: "使用部门", key: "usageDepartment", width: 20 },
    { header: "设备编号", key: "equipmentCode", width: 20 },
    { header: "设备名称", key: "equipmentName", width: 28 },
    { header: "异常原因", key: "message", width: 60 }
  ];
  sheet.getRow(1).font = { bold: true };
  if (errors.length) errors.forEach((error) => sheet.addRow(error));
  else sheet.addRow({ message: "无异常，所有符合筛选条件的行均已成功处理。" });
  await report.xlsx.writeFile(path);
}

async function run() {
  const divisionFilter = option("--division");
  const errorReportPath = option("--error-report");
  const buffer = await stdin(); if (!buffer.length) throw new Error("请通过标准输入提供设备使用管理表.xlsx");
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const assets = workbook.getWorksheet("设备总台账");
  if (!assets) throw new Error("文件必须包含“设备总台账”工作表");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const dataSource = app.get(DataSource); const application = app.get(EquipmentApplicationService);
    const organizations: Array<{ id: string; name: string; path: string[] }> = await dataSource.query(`WITH RECURSIVE org AS (
      SELECT id,name,parent_id,ARRAY[name]::varchar[] path FROM organization_units WHERE parent_id IS NULL
      UNION ALL SELECT child.id,child.name,child.parent_id,parent.path||child.name FROM organization_units child JOIN org parent ON parent.id=child.parent_id
    ) SELECT id,name,path FROM org`);
    const users: Array<{ id: string; displayName: string }> = await dataSource.query(`SELECT id,display_name "displayName" FROM users WHERE enabled=true`);
    const uniqueOrganization = (name: string, preferredDivision?: string) => {
      const candidates = organizations.filter((item) => item.name === name);
      const preferred = preferredDivision ? candidates.filter((item) => item.path.includes(divisionAliases[preferredDivision] ?? preferredDivision)) : candidates;
      const matches = preferred.length ? preferred : candidates;
      if (matches.length !== 1) throw new Error(`组织“${name}”匹配到 ${matches.length} 个节点`);
      return matches[0]!;
    };
    const responsibleIds = (source: string) => {
      const names = [...new Set(source.split(/[、,，;；/]/).map((name) => name.trim()).filter(Boolean))];
      return names.map((name) => {
        const matches = users.filter((user) => user.displayName.trim() === name);
        if (matches.length !== 1) throw new Error(`责任人“${name}”匹配到 ${matches.length} 个启用成员`);
        return matches[0]!.id;
      });
    };
    const rows: Array<{
      sourceSheetRow: number; divisionId: string; usageDepartmentId: string | null; usageDepartmentName: string;
      equipmentCode: string; equipmentName: string; purchaseDate: string | null; monitored: boolean;
      responsibleUserIds?: string[];
    }> = [];
    const errors: ImportError[] = [];
    let sourceRows = 0; let skipped = 0;
    for (let row = 2; row <= assets.rowCount; row++) {
      const divisionSource = cellText(assets.getCell(row, 1)); const departmentSource = cellText(assets.getCell(row, 2));
      const equipmentCode = cellText(assets.getCell(row, 3)); const equipmentName = cellText(assets.getCell(row, 4));
      const monitoringSource = cellText(assets.getCell(row, 6)); const responsibleSource = cellText(assets.getCell(row, 7));
      if (![divisionSource, departmentSource, equipmentCode, equipmentName].some(Boolean)) continue;
      if (divisionFilter && divisionSource !== divisionFilter) continue;
      sourceRows += 1;
      if (shouldSkipEquipmentImport(monitoringSource)) { skipped += 1; continue; }
      try {
        if (!divisionSource || !equipmentCode || !equipmentName) throw new Error("缺少事业部、设备编号或设备名称");
        const division = uniqueOrganization(divisionAliases[divisionSource] ?? divisionSource);
        const departmentName = departmentAliases[`${divisionSource}|${departmentSource}`] ?? departmentSource;
        const department = departmentName ? uniqueOrganization(departmentName, divisionSource) : null;
        const purchaseValue = assets.getCell(row, 5).value;
        const purchaseDate = excelDate(purchaseValue);
        if (purchaseValue !== null && purchaseValue !== undefined && String(purchaseValue).trim() && !purchaseDate) throw new Error("购买日期格式无效");
        rows.push({
          sourceSheetRow: row, divisionId: division.id, usageDepartmentId: department?.id ?? null,
          usageDepartmentName: departmentSource, equipmentCode, equipmentName,
          purchaseDate, monitored: monitoringValue(monitoringSource), responsibleUserIds: responsibleIds(responsibleSource)
        });
      } catch (error) {
        errors.push({
          sourceSheetRow: row, division: divisionSource, usageDepartment: departmentSource,
          equipmentCode, equipmentName, message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await writeErrorReport(errorReportPath, errors);
    const [admin] = await dataSource.query(`SELECT id FROM users WHERE username='admin' LIMIT 1`);
    const actor = {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: admin?.id ?? null,
      username: "设备台账初始化导入", permissions: ["*"], tableDataScopes: [], requestId: `equipment-import-${randomUUID()}`, source: "import" as const
    };
    const result = { sourceRows, skipped, validRows: rows.length, created: 0, updated: 0, unchanged: 0, failed: errors.length, errorReport: errorReportPath || null };
    for (const row of rows) {
      try {
        const rowResult = await modificationContext.run(
          { actor: actor.username, actorId: actor.userId, requestId: `${actor.requestId}:${row.sourceSheetRow}`, source: "import" },
          () => application.importWorkbookRows([row], { ...actor, requestId: `${actor.requestId}:${row.sourceSheetRow}` })
        );
        result.created += rowResult.created;
        result.updated += rowResult.updated;
        result.unchanged += rowResult.unchanged;
      } catch (error) {
        result.failed += 1;
        errors.push({
          sourceSheetRow: row.sourceSheetRow, division: divisionFilter || "",
          usageDepartment: row.usageDepartmentName, equipmentCode: row.equipmentCode,
          equipmentName: row.equipmentName, message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    await writeErrorReport(errorReportPath, errors);
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
