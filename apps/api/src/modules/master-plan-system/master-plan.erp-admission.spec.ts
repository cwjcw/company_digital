import {
  MASTER_PLAN_ERP_ADMISSION, erpAccountWhitelistSql, erpOrderAdmissibleStatusSql, erpOrderDateAdmissionSql, erpSourceIdentitySql
} from "./master-plan.erp-admission";

/**
 * KN-MPS-LIVE-002：准入边界常量是唯一权威来源。
 * 这里锁定「只读科加账套 + 下单日期水位 2026-09-17 + 关闭/作废不得作为新单准入」，
 * 防止以后有人为了省事把三账套混合表重新整表投影。
 */
describe("MASTER_PLAN_ERP_ADMISSION", () => {
  it("只允许科加账套，其他账套全部暂停", () => {
    expect(MASTER_PLAN_ERP_ADMISSION.sourceDatabase).toBe("UFTData418971_000003");
    expect(MASTER_PLAN_ERP_ADMISSION.sourceKey).toBe("tplus-kejia");
    expect(MASTER_PLAN_ERP_ADMISSION.sourceSystem).toBe("T+");
    const whitelist = erpAccountWhitelistSql("o");
    expect(whitelist).toBe("o.source_database='UFTData418971_000003'");
    /* 其他账套绝不能出现在白名单谓词里。 */
    expect(whitelist).not.toContain("E10");
    expect(whitelist).not.toContain("UFTData741219_000012");
  });

  it("业务准入水位是下单日期，而不是创建/更新时间", () => {
    const predicate = erpOrderDateAdmissionSql("o");
    expect(predicate).toContain("o.order_date >= DATE '2026-09-17'");
    expect(predicate).toContain("o.order_date IS NOT NULL");
    expect(predicate).not.toContain("created_at");
    expect(predicate).not.toContain("updated_at");
  });

  it("已关闭/已完成/已作废不得作为新订单准入（状态为空按未关闭处理）", () => {
    expect(MASTER_PLAN_ERP_ADMISSION.blockedOrderStatuses).toEqual(["已关闭", "已完成", "已作废"]);
    const predicate = erpOrderAdmissibleStatusSql("o");
    expect(predicate).toBe("(o.close_status IS NULL OR o.close_status NOT IN ('已关闭','已完成','已作废'))");
  });

  it("来源身份表达式与 mps_erp_order_lines 唯一键一致", () => {
    expect(erpSourceIdentitySql("o")).toEqual({
      sourceSystem: "coalesce(o.source_system,'SYSTEM')",
      sourceDatabase: "coalesce(o.source_database,'KDOS')",
      sourceKey: "coalesce(o.source_key,o.id::text)"
    });
  });
});
