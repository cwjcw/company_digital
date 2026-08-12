const path = require("node:path");
const ExcelJS = require("exceljs");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

async function run() {
  const file = process.argv[2];
  if (!file) throw new Error("请提供企业微信通讯录 XLSX 文件路径");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.worksheets[0];
  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => headers.set(cell.text.trim(), column));
  const get = (row, header) => { const column = headers.get(header); return column ? row.getCell(column).text.trim() : ""; };
  const contacts = new Map();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const wechatUserId = get(row, "userid"); if (!wechatUserId) return;
    const pathValues = ["部门1", "部门2", "部门3", "部门4", "部门5"].map((header) => get(row, header)).filter(Boolean).filter((value, index, values) => index === 0 || value !== values[index - 1]);
    let leaders = []; try { const value = JSON.parse(get(row, "direct_leader") || "[]"); leaders = Array.isArray(value) ? value.map(String) : []; } catch {}
    const prior = contacts.get(wechatUserId);
    if (prior) { if (pathValues.length && !prior.paths.some((candidate) => candidate.join("/") === pathValues.join("/"))) prior.paths.push(pathValues); prior.directLeaders = [...new Set([...prior.directLeaders, ...leaders])]; return; }
    contacts.set(wechatUserId, { wechatUserId, employeeNo: get(row, "工号") || null, name: get(row, "name") || wechatUserId, position: get(row, "position") || null, telephone: get(row, "telephone") || null, directLeaders: leaders, paths: pathValues.length ? [pathValues] : [], enabled: get(row, "enable") !== "0" });
  });
  const client = new Client({ host: process.env.DATABASE_HOST ?? "127.0.0.1", port: Number(process.env.DATABASE_PORT ?? 5432), user: process.env.DATABASE_USER ?? "postgres", password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME ?? "four_department_tracker" });
  await client.connect();
  const passwordHash = await bcrypt.hash("kainice123", 12);
  const roleResult = await client.query(`SELECT id FROM roles WHERE name='白板' LIMIT 1`);
  const whiteboardRoleId = roleResult.rows[0]?.id;
  for (const contact of contacts.values()) await client.query(`INSERT INTO contacts (wechat_user_id, employee_no, name, position, telephone, direct_leaders, department_paths, enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (wechat_user_id) DO UPDATE SET employee_no=EXCLUDED.employee_no,name=EXCLUDED.name,position=EXCLUDED.position,telephone=EXCLUDED.telephone,direct_leaders=EXCLUDED.direct_leaders,department_paths=EXCLUDED.department_paths,enabled=EXCLUDED.enabled,imported_at=now()`, [contact.wechatUserId, contact.employeeNo, contact.name, contact.position, contact.telephone, JSON.stringify(contact.directLeaders), JSON.stringify(contact.paths), contact.enabled]);
  for (const contact of contacts.values()) {
    const username = contact.employeeNo || contact.wechatUserId;
    const existing = await client.query(`SELECT u.id, u.display_name, COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), ARRAY[]::text[]) AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.username=$1 OR ($2 IS NOT NULL AND u.employee_no=$2) GROUP BY u.id`, [username, contact.employeeNo]);
    let userId = existing.rows[0]?.id;
    const roles = existing.rows[0]?.roles ?? [];
    if (!userId) {
      const created = await client.query(`INSERT INTO users (username,display_name,password_hash,enabled,division,employee_no,wechat_user_id,position,department_paths,must_change_password,last_login_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NULL) RETURNING id`, [username,contact.name,passwordHash,contact.enabled,null,contact.employeeNo,contact.wechatUserId,contact.position,JSON.stringify(contact.paths)]);
      userId = created.rows[0].id;
    } else {
      const preservePassword = contact.employeeNo === '09432' || contact.name === '崔玮杰';
      await client.query(`UPDATE users SET display_name=$2,enabled=$3,employee_no=$4,wechat_user_id=$5,position=$6,department_paths=$7${preservePassword ? '' : ',password_hash=$8,must_change_password=true'} WHERE id=$1`, preservePassword ? [userId,contact.name,contact.enabled,contact.employeeNo,contact.wechatUserId,contact.position,JSON.stringify(contact.paths)] : [userId,contact.name,contact.enabled,contact.employeeNo,contact.wechatUserId,contact.position,JSON.stringify(contact.paths),passwordHash]);
    }
    if (whiteboardRoleId && !roles.some((role) => role === '系统管理员' || role === '集团管理员')) await client.query(`INSERT INTO user_roles (user_id,role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [userId, whiteboardRoleId]);
  }
  await client.end();
  console.log(`已同步 ${contacts.size} 位员工（源文件 ${sheet.rowCount - 1} 行）`);
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
