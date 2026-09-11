#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire("/app/apps/api/package.json");
const ExcelJS = require("exceljs");
const { JwtService } = require("@nestjs/jwt");
const dataSourceModule = require("/app/apps/api/dist/data-source.js");
const { User } = require("/app/apps/api/dist/entities.js");
const dataSource = dataSourceModule.default ?? dataSourceModule;
const output = process.argv[2];
if (!output) throw new Error("请指定输出文件路径");

const baseUrl = "http://127.0.0.1:15173/api/v1";
const tenantCode = process.env.KDOS_DEFAULT_TENANT_CODE || "KAINAN";
const excludedMonthlyFields = new Set(["unitPrice", "inboundAmount", "balanceAmount"]);
const auditFields = new Set(["createdBy", "updatedBy"]);

const salesFields = [
  ["订单信息", "账套", "sourceAccountName"],
  ["订单信息", "订单类型", "orderType"],
  ["订单信息", "客户", "customer"],
  ["订单信息", "业务员", "salesperson"],
  ["订单信息", "订单号", "orderNumber"],
  ["订单信息", "下单日期", "orderDate"],
  ["订单信息", "客户要求交期", "customerDueDate"],
  ["订单信息", "产前评审交期", "reviewDueDate"],
  ["订单信息", "异常后二次交期", "exceptionDueDate"],
  ["订单信息", "异常交货方式", "exceptionDeliveryMethod"],
  ["订单信息", "订单金额", "orderAmount"],
  ["订单信息", "订单总数量", "totalQuantity"],
  ["订单执行信息", "承产单位", "division"],
  ["订单执行信息", "已完成数量", "completedQuantity"],
  ["订单执行信息", "待完成数量", "pendingQuantity"],
  ["订单执行信息", "完成比例", "completionRate"],
  ["订单执行信息", "订单实际完成日期", "actualCompletionDate"],
  ["订单执行信息", "出货日期", "shippingDate"],
  ["订单执行结果评估", "交期评分", "deliveryScore"],
  ["订单执行结果评估", "品质评分", "qualityScore"],
  ["审计信息", "创建人", "createdBy"],
  ["审计信息", "创建时间", "createdAt"],
  ["审计信息", "更新人", "updatedBy"],
  ["审计信息", "更新时间", "updatedAt"]
];

function valueAt(row, path) {
  return path.split(".").reduce((value, key) => value?.[key], row);
}

function printable(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(printable).join("、");
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function displayValue(row, code, userNames, organizations) {
  const value = valueAt(row, code);
  if (auditFields.has(code)) {
    if (value == null || value === "" || value === "system") return "系统";
    return userNames.get(String(value)) ?? "未知用户";
  }
  if (code === "responsibleOrgId") return organizations.get(String(value ?? "")) ?? printable(value);
  return printable(value);
}

function styleSheet(sheet, fieldCount) {
  sheet.views = [{ state: "frozen", xSplit: Math.min(4, fieldCount), ySplit: 2 }];
  sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: fieldCount } };
  for (const row of [sheet.getRow(1), sheet.getRow(2)]) {
    row.height = 30;
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4B70" } };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  for (let column = 1; column <= fieldCount; column += 1) sheet.getColumn(column).width = 16;
  sheet.eachRow((row, number) => {
    if (number > 2) row.alignment = { vertical: "middle", wrapText: false };
  });
}

function mergeGroups(sheet, fields) {
  let start = 1;
  for (let column = 2; column <= fields.length + 1; column += 1) {
    const previous = fields[column - 2][0];
    const current = fields[column - 1]?.[0];
    if (current !== previous) {
      if (column - start > 1) sheet.mergeCells(1, start, 1, column - 1);
      start = column;
    }
  }
}

async function api(path, token) {
  const response = await fetch(baseUrl + path, {
    headers: { authorization: `Bearer ${token}`, "x-tenant-code": tenantCode }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} 返回 ${response.status}：${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function internalAccessToken() {
  await dataSource.initialize();
  try {
    const username = process.env.ADMIN_USERNAME || "admin";
    const user = await dataSource.getRepository(User).findOneBy({ username, enabled: true });
    if (!user) throw new Error("未找到启用的系统管理员账号");
    const jwt = new JwtService();
    return jwt.signAsync(
      { sub: user.id, type: "access", jti: randomUUID() },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "5m" }
    );
  } finally {
    await dataSource.destroy();
  }
}

const token = await internalAccessToken();
const [salesPage, period, monthlyFieldsRaw, directory, organizationOptions] = await Promise.all([
  api("/plans/rolling?page=1&pageSize=20&sortField=orderNumber&sortOrder=asc", token),
  api("/planning/periods/by-month?year=2026&month=9", token),
  api("/planning/fields", token),
  api("/directory/users", token),
  api("/planning/organization-options", token)
]);
if (!period) throw new Error("2026年9月没有月度计划");
const version = period.versions.find((entry) => entry.status === "DRAFT")
  ?? period.versions.find((entry) => entry.id === period.currentVersionId)
  ?? period.versions[0];
if (!version) throw new Error("2026年9月没有可用的月度计划版本");
const monthlyPage = await api(`/planning/versions/${encodeURIComponent(version.id)}/items?page=1&pageSize=20`, token);

const userNames = new Map();
for (const user of directory) {
  const name = String(user.displayName || user.username || "").trim();
  if (name) {
    userNames.set(String(user.id), name);
    userNames.set(String(user.username), name);
  }
}
const organizations = new Map(organizationOptions.map((entry) => [String(entry.id), String(entry.name)]));
const monthlyFields = monthlyFieldsRaw
  .filter((field) => !excludedMonthlyFields.has(field.code))
  .sort((left, right) => Number(left.order) - Number(right.order));
const customerIndex = monthlyFields.findIndex((field) => field.code === "customer");
const orderIndex = monthlyFields.findIndex((field) => field.code === "orderNumber");
if (customerIndex >= 0 && orderIndex >= 0) {
  const [customer] = monthlyFields.splice(customerIndex, 1);
  monthlyFields.splice(monthlyFields.findIndex((field) => field.code === "orderNumber"), 0, customer);
}

const workbook = new ExcelJS.Workbook();
workbook.creator = "KDOS Planning Center";
workbook.created = new Date();

const salesSheet = workbook.addWorksheet("销售接单明细");
salesSheet.addRow(salesFields.map(([group]) => group));
salesSheet.addRow(salesFields.map(([, label]) => label));
for (const row of salesPage.rows.slice(0, 10)) {
  salesSheet.addRow(salesFields.map(([, , code]) => displayValue(row, code, userNames, organizations)));
}
mergeGroups(salesSheet, salesFields);
styleSheet(salesSheet, salesFields.length);

const monthlyTuples = monthlyFields.map((field) => [field.groupLabel, field.label, field.code]);
const monthlySheet = workbook.addWorksheet("202609月度计划");
monthlySheet.addRow(monthlyTuples.map(([group]) => group));
monthlySheet.addRow(monthlyTuples.map(([, label]) => label));
for (const row of monthlyPage.rows.slice(0, 10)) {
  monthlySheet.addRow(monthlyTuples.map(([, , code]) => displayValue(row, code, userNames, organizations)));
}
mergeGroups(monthlySheet, monthlyTuples);
styleSheet(monthlySheet, monthlyTuples.length);

await workbook.xlsx.writeFile(output);
console.log(JSON.stringify({
  output,
  salesTotal: salesPage.total,
  salesExported: Math.min(10, salesPage.rows.length),
  monthlyVersionId: version.id,
  monthlyVersionStatus: version.status,
  monthlyTotal: monthlyPage.total,
  monthlyExported: Math.min(10, monthlyPage.rows.length)
}));
