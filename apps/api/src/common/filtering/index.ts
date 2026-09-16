/** KN-FILTER-001 平台级筛选能力入口：所有正式业务表共用这一份协议、动态日期与安全编译器。 */
export { SqlFilterCompiler, type FilterOptionResolver } from "./sql-filter.compiler";
/** 兼容别名：主计划模块沿用 MasterPlanFilterCompiler 名称（实现完全相同）。 */
export { SqlFilterCompiler as MasterPlanFilterCompiler } from "./sql-filter.compiler";
export { maxFilterRules, isBlankFilterValue, parseFilterGroup, type TypedFilterRule } from "./filter.contract";
export { dynamicDateRange } from "./dynamic-date";
