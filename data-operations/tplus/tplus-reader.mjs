import fs from "node:fs/promises";
import sql from "mssql";

export const sourceDatabases = ["UFTData741219_000012", "UFTData418971_000003"];

export function prepareSql(source, beginDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beginDate)) throw new Error("TPLUS_BEGIN_DATE 必须使用 YYYY-MM-DD 格式");
  const beginDeclaration = /DECLARE\s+@BeginDate\s+date\s*=\s*NULL\s*;/i;
  const diagnosticsDeclaration = /DECLARE\s+@ShowDiagnostics\s+bit\s*=\s*0\s*;/i;
  if (!beginDeclaration.test(source)) throw new Error("SQL 文件中没有找到 @BeginDate = NULL 参数声明");
  if (!diagnosticsDeclaration.test(source)) throw new Error("SQL 文件中没有找到 @ShowDiagnostics = 0 参数声明");
  return source
    .replace(beginDeclaration, `DECLARE @BeginDate date = '${beginDate.replaceAll("-", "")}';`)
    .replace(diagnosticsDeclaration, "DECLARE @ShowDiagnostics bit = 1;");
}

export function useReadCommitted(source) {
  return `SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\n${source}`;
}

const dateText = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
};

export function mapOrder(row) {
  return {
    sourceDatabase: String(row["源数据库"] ?? row.SourceDatabase ?? ""),
    customerCode: row["客户代码"] == null ? null : String(row["客户代码"]),
    salesperson: row["业务员（姓名）"] == null ? null : String(row["业务员（姓名）"]),
    orderNumber: String(row["订单号"] ?? ""),
    orderDate: dateText(row["下单日期"]),
    customerRequiredDate: dateText(row["客户要求交期"]),
    reviewDueDate: dateText(row["产前评审交期"]),
    orderAmount: row["订单金额（人民币，元）"] == null ? null : String(row["订单金额（人民币，元）"]),
    totalQuantity: String(row["订单总数量"] ?? "")
  };
}

function hasColumn(recordset, name) {
  return Boolean(recordset?.columns?.[name]) || Boolean(recordset?.[0] && name in recordset[0]);
}

export async function readTplusOrders(config) {
  const source = await fs.readFile(config.sqlFile, "utf8");
  const query = useReadCommitted(prepareSql(source, config.beginDate));
  const pool = await new sql.ConnectionPool(config.sql).connect();
  try {
    const result = await pool.request().batch(query);
    const recordsets = result.recordsets ?? [];
    const failures = recordsets.find((set) => hasColumn(set, "诊断类型")) ?? [];
    if (failures.length) {
      const detail = failures.map((row) => `${row["账套"]}/${row["数据库"]}: ${row["诊断类型"]} - ${row["诊断信息"]}`).join("；");
      throw new Error(`T+ 查询诊断失败：${detail}`);
    }
    const reviewFields = recordsets.find((set) => hasColumn(set, "实际字段")) ?? [];
    const reviewedDatabases = new Set(reviewFields.map((row) => String(row["数据库"] ?? "")));
    const missing = sourceDatabases.filter((database) => !reviewedDatabases.has(database));
    if (missing.length) throw new Error(`T+ 查询没有完成全部账套的结构诊断：${missing.join("、")}`);
    const orderRows = recordsets.find((set) => hasColumn(set, "订单号")) ?? [];
    return orderRows.map((row) => {
      const mapped = mapOrder(row);
      if (!mapped.sourceDatabase) {
        const account = String(row["账套"] ?? "");
        mapped.sourceDatabase = account === "凯南智能" ? sourceDatabases[0] : account === "科加智能" ? sourceDatabases[1] : "";
      }
      return mapped;
    });
  } finally {
    await pool.close();
  }
}
