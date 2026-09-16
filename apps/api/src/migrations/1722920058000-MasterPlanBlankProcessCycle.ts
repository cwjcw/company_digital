import { MigrationInterface, QueryRunner } from "typeorm";

/** KN-PROC-001：唯一正式 10 标准工序（毛坯位于研磨之后、表面处理之前）。 */
const CANONICAL_PROCESSES: Array<[string, string, number]> = [
  ["cutting", "下料", 1],
  ["machining", "机加", 2],
  ["bending", "折弯", 3],
  ["spotWelding", "点焊", 4],
  ["welding", "焊接", 5],
  ["woodworking", "木作", 6],
  ["grinding", "研磨", 7],
  ["blank", "毛坯", 8],
  ["surfaceTreatment", "表面处理", 9],
  ["packaging", "包装", 10]
];

/** 已退役的旧 Planning 工序（仅用于 migration 回滚时恢复历史定义）。 */
const RETIRED_PROCESSES: Array<[string, string, number]> = [
  ["drawingBom", "图纸&BOM", 1],
  ["metalMain", "五金主材", 2],
  ["woodMain", "木作主材", 3],
  ["frontParts", "前道配件", 4],
  ["machining", "机加", 5],
  ["welding", "焊接/点焊", 6],
  ["grinding", "研磨", 7],
  ["blank", "毛坯", 8],
  ["woodwork", "木作", 9],
  ["painting", "油漆", 10],
  ["acrylic", "亚克力", 11],
  ["bakingPlating", "烤漆/电镀", 12],
  ["rearPackingParts", "后道包材&配件", 13],
  ["assemblyPacking", "组装&包装", 14]
];

export class MasterPlanBlankProcessCycle1722920058000 implements MigrationInterface {
  name = "MasterPlanBlankProcessCycle1722920058000";

  async up(queryRunner: QueryRunner): Promise<void> {
    /* 毛坯周期列：类型、精度、可空性与其它工序周期列保持一致（integer NULL），历史记录保持 NULL。 */
    await queryRunner.query(`ALTER TABLE mps_process_cycles ADD COLUMN IF NOT EXISTS blank_days integer NULL`);
    await queryRunner.query(`COMMENT ON COLUMN mps_process_cycles.blank_days IS '毛坯工序周期（KN-PROC-001）：历史记录保持 NULL，不凭空填写周期'`);

    /* 工序主数据统一为 10 个正式标准工序；其余 legacy 工序在无历史引用时直接移除。 */
    for (const [code, name, order] of CANONICAL_PROCESSES) {
      await queryRunner.query(`INSERT INTO process_definitions(code,name,sort_order,enable_required_days,enable_due_date,enable_status,enable_exception,enabled,updated_by)
        VALUES($1,$2,$3,true,true,true,true,true,'KN-PROC-001')
        ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,enable_required_days=true,enable_due_date=true,
          enable_status=true,enable_exception=true,enabled=true,updated_at=now(),updated_by=EXCLUDED.updated_by,version=process_definitions.version+1`,
      [code, name, order]);
    }
    const canonicalCodes = CANONICAL_PROCESSES.map(([code]) => code);
    await queryRunner.query(`DELETE FROM process_definitions definition
      WHERE definition.code <> ALL($1::varchar[])
        AND NOT EXISTS (SELECT 1 FROM item_process_progress progress WHERE progress.process_definition_id=definition.id)`, [canonicalCodes]);
    await queryRunner.query(`UPDATE process_definitions SET enabled=false,updated_at=now(),updated_by='KN-PROC-001',version=version+1
      WHERE code <> ALL($1::varchar[])`, [canonicalCodes]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    /* 回滚：恢复旧 Planning 14 工序定义名称与顺序，并移除本任务新增的毛坯周期列。 */
    for (const [code, name, order] of RETIRED_PROCESSES) {
      await queryRunner.query(`INSERT INTO process_definitions(code,name,sort_order,enable_required_days,enable_due_date,enable_status,enable_exception,enabled,updated_by)
        VALUES($1,$2,$3,true,true,true,true,true,'KN-PROC-001-rollback')
        ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,sort_order=EXCLUDED.sort_order,enabled=true,updated_at=now(),
          updated_by=EXCLUDED.updated_by,version=process_definitions.version+1`,
      [code, name, order]);
    }
    /* 仅存在于新 registry 的行在回滚时移除，使工序主数据精确回到旧 14 工序状态（有历史引用时保留为停用）。 */
    const retiredCodes = RETIRED_PROCESSES.map(([code]) => code);
    await queryRunner.query(`DELETE FROM process_definitions definition
      WHERE definition.code <> ALL($1::varchar[])
        AND NOT EXISTS (SELECT 1 FROM item_process_progress progress WHERE progress.process_definition_id=definition.id)`, [retiredCodes]);
    await queryRunner.query(`UPDATE process_definitions SET enabled=false,updated_at=now(),updated_by='KN-PROC-001-rollback',version=version+1
      WHERE code <> ALL($1::varchar[])`, [retiredCodes]);
    await queryRunner.query(`ALTER TABLE mps_process_cycles DROP COLUMN IF EXISTS blank_days`);
  }
}
