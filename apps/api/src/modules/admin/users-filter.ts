/**
 * KN-FILTER-001：用户（users）资源在平台筛选中的唯一列绑定。
 * 用户列表（/admin/users 分页查询）与平台 `/table-filters/rows`、candidate 共用这一份定义，
 * 避免出现第二套列映射或前端字符串过滤。
 *
 * `roleIds` 使用真实关系（`user_roles`）以 jsonb 数组暴露，配合 `multiple: true` 走数组包含语义，
 * 不做“角色名 contains”的字符串匹配；`departmentPaths` 是多路径 jsonb，不参与筛选（metadata filterable=false）。
 */
export function usersFilterColumns(alias: string): Record<string, string> {
  return {
    username: `${alias}.username`,
    displayName: `${alias}.display_name`,
    employeeNo: `${alias}.employee_no`,
    wechatUserId: `${alias}.wechat_user_id`,
    position: `${alias}.position`,
    alias: `${alias}.alias`,
    gender: `${alias}.gender`,
    mobile: `${alias}.mobile`,
    email: `${alias}.email`,
    division: `${alias}.division`,
    enabled: `${alias}.enabled`,
    lastLoginAt: `${alias}.last_login_at`,
    roleIds: `(SELECT COALESCE(jsonb_agg(link.role_id),'[]'::jsonb) FROM user_roles link WHERE link.user_id = ${alias}.id)`,
    createdBy: `${alias}.created_by`,
    createdAt: `${alias}.created_at`,
    updatedBy: `${alias}.updated_by`,
    updatedAt: `${alias}.updated_at`
  };
}

/** 用户列表的排序白名单（字段 key → 真实数据库列）。 */
export const USERS_SORT_COLUMNS: Record<string, string> = {
  username: "row.username", displayName: "row.display_name", employeeNo: "row.employee_no",
  position: "row.position", division: "row.division", mobile: "row.mobile", email: "row.email",
  lastLoginAt: "row.last_login_at", enabled: "row.enabled", createdAt: "row.created_at", updatedAt: "row.updated_at"
};
