import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import ExcelJS from "exceljs";
import { DataSource } from "typeorm";
import { AppModule } from "../../app.module";
import { modificationContext } from "../../modification-audit";
import { EquipmentApplicationService } from "./equipment.application.service";

const divisionAliases: Record<string, string> = { "事业一部": "事业一部", "事业二部": "事业二部", "事业三部": "事业三部", "事业四部": "事业四部", "研发": "研发中心" };
const departmentAliases: Record<string, string> = {
  "事业一部|下料中心": "下料课", "事业一部|亚克力车间": "亚克力",
  "事业二部|制造二部": "二部生产部", "事业四部|品管部": "四部品管部",
  "事业四部|烤漆车间": "喷涂课", "事业四部|生产部": "四部生产部", "研发|研发": "研发中心"
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

async function run() {
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
    const uniqueOrganization = (name: string, preferredDivision?: string) => {
      const candidates = organizations.filter((item) => item.name === name);
      const preferred = preferredDivision ? candidates.filter((item) => item.path.includes(divisionAliases[preferredDivision] ?? preferredDivision)) : candidates;
      const matches = preferred.length ? preferred : candidates;
      if (matches.length !== 1) throw new Error(`组织“${name}”匹配到 ${matches.length} 个节点`);
      return matches[0]!;
    };
    const rows: Array<{
      sourceSheetRow: number; divisionId: string; usageDepartmentId: string | null; usageDepartmentName: string;
      equipmentCode: string; equipmentName: string; purchaseDate: string | null; monitored: boolean;
      responsibleUserIds?: string[];
    }> = [];
    for (let row = 2; row <= assets.rowCount; row++) {
      const divisionSource = cellText(assets.getCell(row, 1)); const departmentSource = cellText(assets.getCell(row, 2));
      const equipmentCode = cellText(assets.getCell(row, 3)); const equipmentName = cellText(assets.getCell(row, 4));
      if (![divisionSource, departmentSource, equipmentCode, equipmentName].some(Boolean)) continue;
      if (!divisionSource || !equipmentCode || !equipmentName) throw new Error(`设备总台账第 ${row} 行缺少事业部、设备编号或设备名称`);
      const division = uniqueOrganization(divisionAliases[divisionSource] ?? divisionSource);
      const departmentName = departmentAliases[`${divisionSource}|${departmentSource}`] ?? departmentSource;
      const department = departmentName ? uniqueOrganization(departmentName, divisionSource) : null;
      rows.push({
        sourceSheetRow: row, divisionId: division.id, usageDepartmentId: department?.id ?? null,
        usageDepartmentName: departmentSource, equipmentCode, equipmentName,
        purchaseDate: excelDate(assets.getCell(row, 5).value), monitored: false,
        responsibleUserIds: undefined
      });
    }
    const [admin] = await dataSource.query(`SELECT id FROM users WHERE username='admin' LIMIT 1`);
    const actor = {
      tenantId: process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN", userId: admin?.id ?? null,
      username: "设备台账初始化导入", permissions: ["*"], tableDataScopes: [], requestId: `equipment-import-${randomUUID()}`, source: "import" as const
    };
    const result = await modificationContext.run({ actor: actor.username, actorId: actor.userId, requestId: actor.requestId, source: "import" },
      () => application.importWorkbookRows(rows, actor));
    console.log(JSON.stringify(result));
  } finally { await app.close(); }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
