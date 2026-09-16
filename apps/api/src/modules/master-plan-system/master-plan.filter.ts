/**
 * Master Plan 侧只保留本模块自己的筛选绑定（字段、表达式与字典解析），
 * 通用协议、动态日期与安全编译器已提升到平台级 `apps/api/src/common/filtering/`，
 * 其他模块（设备/营销/数据中心/HR/流程/系统管理）必须直接使用平台实现，不得复制。
 */
export {
  MasterPlanFilterCompiler, dynamicDateRange, isBlankFilterValue, maxFilterRules, parseFilterGroup,
  type TypedFilterRule
} from "../../common/filtering";
