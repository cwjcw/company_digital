import "reflect-metadata";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { dictionarySeeds, processDefinitions } from "@tracker/shared";
import dataSource from "./data-source";
import {
  DictionaryType, DictionaryValue, Permission, PlanPeriod, ProcessDefinitionEntity,
  Role, User, UserRole
} from "./entities";
import { DEFAULT_USER_PASSWORD } from "./user-defaults";

async function seed() {
  await dataSource.initialize();
  const roles = dataSource.getRepository(Role);
  const users = dataSource.getRepository(User);
  const userRoles = dataSource.getRepository(UserRole);
  const permissions = dataSource.getRepository(Permission);
  const roleNames = ["系统管理员", "集团管理员", "事业部计划组", "计划员", "事业部编辑", "只读用户"];
  const roleMap = new Map<string, Role>();
  for (const name of roleNames) {
    let role = await roles.findOneBy({ name });
    role ??= await roles.save({ name, description: `${name}初始角色` });
    roleMap.set(name, role);
  }
  const resources = ["sales-summary-dashboard", "rolling-plan", "monthly-plan", "daily-progress", "weekly-plan", "work-report", "sales-orders", "finished-goods-inbound", "business-customer-mapping", "order-schedule", "suppliers", "dictionaries", "processes", "users", "roles", "organization", "audit-logs", "imports"];
  for (const name of roleNames.filter((name) => name !== "系统管理员")) {
    const role = roleMap.get(name)!;
    for (const resource of resources) {
      const writable = name === "集团管理员" || (["计划员", "事业部编辑", "工序编辑"].includes(name) && !["users", "roles", "organization", "audit-logs"].includes(resource));
      await permissions.createQueryBuilder().insert().values({
        roleId: role.id, resource, fieldKey: "*", read: true, create: writable,
        update: writable, delete: name === "集团管理员" || name === "计划员", import: name === "集团管理员" || name === "计划员", export: true
      }).orIgnore().execute();
    }
  }
  const adminRole = roleMap.get("系统管理员")!;
  const username = process.env.ADMIN_USERNAME ?? "admin";
  let admin = await users.findOneBy({ username });
  if (!admin) {
    const generated = !process.env.ADMIN_INITIAL_PASSWORD;
    const password = process.env.ADMIN_INITIAL_PASSWORD || randomBytes(12).toString("base64url");
    admin = await users.save({
      username, displayName: process.env.ADMIN_DISPLAY_NAME ?? "系统管理员",
      passwordHash: await bcrypt.hash(password, 12), enabled: true,
      division: null, mustChangePassword: true, lastLoginAt: null
    });
    console.log(generated ? `管理员一次性初始密码（仅显示本次）：${password}` : "管理员已使用环境变量中的初始密码创建");
  }
  await userRoles.createQueryBuilder().insert().values({ userId: admin.id, roleId: adminRole.id }).orIgnore().execute();
  const managerRole = roleMap.get("集团管理员")!;
  for (const [username, displayName] of [["01382", "吴志琴"], ["09432", "周志明"]]) {
    let user = await users.findOneBy({ username });
    if (!user) user = await users.save({ username, displayName, passwordHash: await bcrypt.hash(DEFAULT_USER_PASSWORD, 12), enabled: true, division: null, mustChangePassword: true, lastLoginAt: null });
    await userRoles.createQueryBuilder().insert().values({ userId: user.id, roleId: managerRole.id }).orIgnore().execute();
  }

  const processRepo = dataSource.getRepository(ProcessDefinitionEntity);
  for (const process of processDefinitions) {
    await processRepo.createQueryBuilder().insert().values({
      code: process.code, name: process.name, sortOrder: process.order,
      enableRequiredDays: process.fields.includes("requiredDays"),
      enableDueDate: process.fields.includes("dueDate"), enableStatus: process.fields.includes("status"),
      enableException: process.fields.includes("exception"), enabled: true
    }).orUpdate(["name", "sort_order", "enable_required_days", "enable_due_date", "enable_status", "enable_exception"], ["code"]).execute();
  }
  const typeRepo = dataSource.getRepository(DictionaryType);
  const valueRepo = dataSource.getRepository(DictionaryValue);
  const dictionaryTypeNames: Record<string, string> = {
    handlingMethod: "制作方式",
    outsourcingMethod: "外协方式"
  };
  for (const [code, values] of Object.entries(dictionarySeeds)) {
    let type = await typeRepo.findOneBy({ code });
    const name = dictionaryTypeNames[code] ?? code;
    type = type ? await typeRepo.save({ ...type, name }) : await typeRepo.save({ code, name });
    for (const [sortOrder, value] of values.entries()) {
      await valueRepo.createQueryBuilder().insert().values({ typeId: type.id, value, sortOrder, enabled: true }).orIgnore().execute();
    }
  }
  await dataSource.getRepository(PlanPeriod).createQueryBuilder().insert().values({ year: 2026, month: 8, status: "active" }).orIgnore().execute();
  await dataSource.destroy();
}

seed().catch((error) => { console.error(error); process.exitCode = 1; });
