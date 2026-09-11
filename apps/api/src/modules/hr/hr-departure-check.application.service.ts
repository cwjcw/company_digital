import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { Repository } from "typeorm";
import { AuditLog, User } from "../../entities";
import { assertSpreadsheetNotEncrypted } from "../../spreadsheet-upload";

export type HrActor = { userId: string | null; username: string; permissions: string[]; requestId: string };
type DepartureCheckSourceRow = { account: string; name: string };
type DepartureCheckRow = DepartureCheckSourceRow & { status: "入职" | "离职" };

@Injectable()
export class HrDepartureCheckApplicationService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>
  ) {}

  async check(file: Express.Multer.File, actor: HrActor) {
    this.assert(actor, "import");
    if (!file?.buffer?.length) throw new BadRequestException("请选择包含账号和姓名的文件");
    assertSpreadsheetNotEncrypted(file.buffer);
    if (!/\.(xlsx|csv)$/i.test(file.originalname)) throw new BadRequestException("仅支持 .xlsx 或 .csv 文件");
    const workbook = new ExcelJS.Workbook();
    if (/\.csv$/i.test(file.originalname)) await workbook.csv.read(Readable.from([file.buffer]));
    else await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException("文件中没有工作表");
    let headerRow = 0; let accountColumn = 0; let nameColumn = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 10); rowNumber++) {
      sheet.getRow(rowNumber).eachCell((cell, column) => {
        const header = cell.text.replace(/\s+/g, "").trim();
        if (["账号", "工号", "用户名"].includes(header)) accountColumn = column;
        if (["姓名", "员工姓名"].includes(header)) nameColumn = column;
      });
      if (accountColumn && nameColumn) { headerRow = rowNumber; break; }
      accountColumn = 0; nameColumn = 0;
    }
    if (!headerRow) throw new BadRequestException("文件必须包含“账号”和“姓名”两列");
    const sourceRows: DepartureCheckSourceRow[] = [];
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const account = sheet.getRow(rowNumber).getCell(accountColumn).text.trim();
      const name = sheet.getRow(rowNumber).getCell(nameColumn).text.trim();
      if (!account && !name) continue;
      if (!account || !name) throw new BadRequestException(`第 ${rowNumber} 行的账号或姓名为空`);
      sourceRows.push({ account, name });
    }
    if (!sourceRows.length) throw new BadRequestException("文件中没有可检查的人员记录");
    if (sourceRows.length > 50_000) throw new BadRequestException("单次最多检查 50000 人");
    const rows = await this.compare(sourceRows);
    const active = rows.filter((row) => row.status === "入职").length;
    const departed = rows.length - active;
    await this.auditLogs.save({ actorId: actor.userId, actorName: actor.username, resource: "hr-departure-check", recordId: null, action: "hr.departure_check.completed", beforeJson: null, afterJson: { fileName: file.originalname, fileHash: createHash("sha256").update(file.buffer).digest("hex"), rows: rows.length, active, departed }, requestId: actor.requestId, source: "web" });
    return { rows, summary: { total: rows.length, active, departed } };
  }

  async checkManual(input: DepartureCheckSourceRow, actor: HrActor) {
    this.assert(actor, "create");
    const account = String(input?.account ?? "").trim();
    const name = String(input?.name ?? "").trim();
    if (!account || !name) throw new BadRequestException("账号和姓名不能为空");
    if (account.length > 100 || name.length > 100) throw new BadRequestException("账号和姓名不能超过 100 个字符");
    const [row] = await this.compare([{ account, name }]);
    await this.auditLogs.save({
      actorId: actor.userId, actorName: actor.username, resource: "hr-departure-check", recordId: account,
      action: "hr.departure_check.manual_checked", beforeJson: null, afterJson: row, requestId: actor.requestId, source: "web"
    });
    return { row };
  }

  private async compare(sourceRows: DepartureCheckSourceRow[]): Promise<DepartureCheckRow[]> {
    const directoryUsers = await this.users.find();
    const normalizedAccount = (value: string) => value.trim().toLowerCase();
    const withoutLeadingZeroes = (value: string) => value.replace(/^0+(?=\d)/, "");
    return sourceRows.map((row) => {
      const account = normalizedAccount(row.account);
      const user = directoryUsers.find((candidate) => {
        const identities = [candidate.username, candidate.employeeNo].filter(Boolean).map((value) => normalizedAccount(String(value)));
        return identities.some((identity) => identity === account || withoutLeadingZeroes(identity) === withoutLeadingZeroes(account));
      });
      return { ...row, status: user?.enabled && user.displayName.trim() === row.name ? "入职" : "离职" };
    });
  }

  private assert(actor: HrActor, action: string) {
    if (actor.permissions.includes("*") || actor.permissions.includes(`hr-departure-check:*:${action}`)) return;
    throw new ForbiddenException("当前权限组没有离职人员检查权限");
  }
}
