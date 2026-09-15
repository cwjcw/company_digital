import { MigrationInterface, QueryRunner } from "typeorm";

const systemUserId = "0199e000-0000-7000-8000-000000000001";

export class MasterPlanWeeklyIdentity1722920056000 implements MigrationInterface {
  name = "MasterPlanWeeklyIdentity1722920056000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM mps_weekly_plans WHERE base_plan_id IS NULL) THEN
          RAISE EXCEPTION 'mps_weekly_plans contains rows without base_plan_id; manual analysis is required';
        END IF;
        IF EXISTS (
          SELECT 1 FROM mps_weekly_plans
          GROUP BY tenant_id,base_plan_id HAVING count(*)>1
        ) THEN
          RAISE EXCEPTION 'mps_weekly_plans contains duplicate tenant/base_plan_id rows; manual analysis is required';
        END IF;
      END $$;

      ALTER TABLE mps_weekly_plans ALTER COLUMN base_plan_id SET NOT NULL;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='mps_weekly_plans'::regclass AND conname='uq_mps_weekly_base'
        ) THEN
          ALTER TABLE mps_weekly_plans
            ADD CONSTRAINT uq_mps_weekly_base UNIQUE(tenant_id,base_plan_id);
        END IF;
      END $$;

      ALTER TABLE mps_technical_reports DROP CONSTRAINT IF EXISTS uq_mps_technical_report;
      ALTER TABLE mps_material_reports DROP CONSTRAINT IF EXISTS uq_mps_material_report;
      ALTER TABLE mps_outsourcing_reports DROP CONSTRAINT IF EXISTS uq_mps_outsourcing_report;
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT report.id,report.tenant_id,report.weekly_plan_id,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank,
          count(*) OVER (PARTITION BY report.tenant_id,report.weekly_plan_id) group_size
        FROM mps_technical_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      )
      INSERT INTO mps_data_exceptions(
        tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,
        active,resolved_at,created_by,updated_by
      )
      SELECT tenant_id,'weekly-child-duplicate:technical:'||weekly_plan_id,
        'mps-technical-reports',id,weekly_plan_id::text,
        'WEEKLY_CHILD_DUPLICATE_REPAIRED','WARNING',
        '检测到同一事业部周计划存在重复技术报工子记录；migration 已保留人工字段并合并为一条。',
        false,now(),'${systemUserId}'::uuid,'${systemUserId}'::uuid
      FROM ranked WHERE row_rank=1 AND group_size>1
      ON CONFLICT(tenant_id,exception_key) DO UPDATE SET
        resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,
        exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,
        active=false,resolved_at=now(),updated_at=now(),updated_by=excluded.updated_by,
        version=mps_data_exceptions.version+1;
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT report.id,report.tenant_id,report.weekly_plan_id,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank,
          count(*) OVER (PARTITION BY report.tenant_id,report.weekly_plan_id) group_size
        FROM mps_technical_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      ), keepers AS (
        SELECT id,tenant_id,weekly_plan_id FROM ranked WHERE row_rank=1 AND group_size>1
      )
      UPDATE mps_technical_reports target SET
        drawing_due_date=COALESCE(target.drawing_due_date,(
          SELECT source.drawing_due_date FROM mps_technical_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.drawing_due_date IS NOT NULL
          ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
        )),
        status=CASE WHEN target.status<>'未完成' THEN target.status ELSE COALESCE((
          SELECT source.status FROM mps_technical_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.status<>'未完成'
          ORDER BY CASE source.status WHEN '已完成' THEN 2 WHEN '延期' THEN 1 ELSE 0 END DESC,
            source.updated_at DESC,source.id DESC LIMIT 1
        ),target.status) END,
        exception_text=CASE
          WHEN btrim(COALESCE(target.exception_text,''))<>'' AND target.exception_text<>'未维护技术周期'
            THEN target.exception_text
          ELSE COALESCE((
            SELECT source.exception_text FROM mps_technical_reports source
            WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
              AND btrim(COALESCE(source.exception_text,''))<>''
              AND source.exception_text<>'未维护技术周期'
            ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
          ),target.exception_text)
        END,
        responsible_user_id=COALESCE(target.responsible_user_id,(
          SELECT source.responsible_user_id FROM mps_technical_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.responsible_user_id IS NOT NULL
          ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
        )),
        drawing_refs=CASE WHEN target.drawing_refs<>'[]'::jsonb THEN target.drawing_refs ELSE COALESCE((
          SELECT source.drawing_refs FROM mps_technical_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.drawing_refs<>'[]'::jsonb
          ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
        ),target.drawing_refs) END,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=target.version+1
      FROM keepers
      WHERE target.id=keepers.id;

      WITH ranked AS (
        SELECT report.id,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank
        FROM mps_technical_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      )
      DELETE FROM mps_technical_reports target USING ranked
      WHERE target.id=ranked.id AND ranked.row_rank>1;
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT report.id,report.tenant_id,report.weekly_plan_id,report.material_name,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id,report.material_name
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank,
          count(*) OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id,report.material_name
          ) group_size
        FROM mps_material_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      )
      INSERT INTO mps_data_exceptions(
        tenant_id,exception_key,resource,record_id,business_key,exception_type,severity,message,
        active,resolved_at,created_by,updated_by
      )
      SELECT tenant_id,'weekly-child-duplicate:material:'||weekly_plan_id||':'||material_name,
        'mps-material-reports',id,weekly_plan_id::text||'/'||material_name,
        'WEEKLY_CHILD_DUPLICATE_REPAIRED','WARNING',
        '检测到同一事业部周计划存在重复'||material_name||'报工子记录；migration 已保留人工字段并合并为一条。',
        false,now(),'${systemUserId}'::uuid,'${systemUserId}'::uuid
      FROM ranked WHERE row_rank=1 AND group_size>1
      ON CONFLICT(tenant_id,exception_key) DO UPDATE SET
        resource=excluded.resource,record_id=excluded.record_id,business_key=excluded.business_key,
        exception_type=excluded.exception_type,severity=excluded.severity,message=excluded.message,
        active=false,resolved_at=now(),updated_at=now(),updated_by=excluded.updated_by,
        version=mps_data_exceptions.version+1;
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT report.id,report.tenant_id,report.weekly_plan_id,report.material_name,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id,report.material_name
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank,
          count(*) OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id,report.material_name
          ) group_size
        FROM mps_material_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      ), keepers AS (
        SELECT id,tenant_id,weekly_plan_id,material_name FROM ranked
        WHERE row_rank=1 AND group_size>1
      )
      UPDATE mps_material_reports target SET
        received=target.received OR COALESCE((
          SELECT bool_or(source.received) FROM mps_material_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.material_name=target.material_name
        ),false),
        actual_inbound_date=COALESCE(target.actual_inbound_date,(
          SELECT source.actual_inbound_date FROM mps_material_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.material_name=target.material_name AND source.actual_inbound_date IS NOT NULL
          ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
        )),
        exception_text=CASE WHEN btrim(COALESCE(target.exception_text,''))<>'' THEN target.exception_text ELSE COALESCE((
          SELECT source.exception_text FROM mps_material_reports source
          WHERE source.tenant_id=target.tenant_id AND source.weekly_plan_id=target.weekly_plan_id
            AND source.material_name=target.material_name
            AND btrim(COALESCE(source.exception_text,''))<>''
          ORDER BY source.updated_at DESC,source.id DESC LIMIT 1
        ),target.exception_text) END,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=target.version+1
      FROM keepers
      WHERE target.id=keepers.id;

      WITH ranked AS (
        SELECT report.id,
          row_number() OVER (
            PARTITION BY report.tenant_id,report.weekly_plan_id,report.material_name
            ORDER BY (
              report.order_number=weekly.order_number
              AND report.item_code=weekly.item_code
              AND report.delivery_number=weekly.delivery_number
              AND report.item_name IS NOT DISTINCT FROM weekly.item_name
              AND report.division_id IS NOT DISTINCT FROM weekly.division_id
            ) DESC,report.updated_at DESC,report.id DESC
          ) row_rank
        FROM mps_material_reports report
        JOIN mps_weekly_plans weekly
          ON weekly.tenant_id=report.tenant_id AND weekly.id=report.weekly_plan_id
      )
      DELETE FROM mps_material_reports target USING ranked
      WHERE target.id=ranked.id AND ranked.row_rank>1;
    `);

    await queryRunner.query(`
      UPDATE mps_technical_reports child SET
        division_id=weekly.division_id,order_number=weekly.order_number,item_code=weekly.item_code,
        item_name=weekly.item_name,delivery_number=weekly.delivery_number,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=child.version+1
      FROM mps_weekly_plans weekly
      WHERE weekly.tenant_id=child.tenant_id AND weekly.id=child.weekly_plan_id
        AND (child.division_id,child.order_number,child.item_code,child.item_name,child.delivery_number)
          IS DISTINCT FROM (weekly.division_id,weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number);

      UPDATE mps_material_reports child SET
        division_id=weekly.division_id,order_number=weekly.order_number,item_code=weekly.item_code,
        item_name=weekly.item_name,delivery_number=weekly.delivery_number,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=child.version+1
      FROM mps_weekly_plans weekly
      WHERE weekly.tenant_id=child.tenant_id AND weekly.id=child.weekly_plan_id
        AND (child.division_id,child.order_number,child.item_code,child.item_name,child.delivery_number)
          IS DISTINCT FROM (weekly.division_id,weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number);

      UPDATE mps_outsourcing_reports child SET
        division_id=weekly.division_id,order_number=weekly.order_number,item_code=weekly.item_code,
        item_name=weekly.item_name,delivery_number=weekly.delivery_number,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=child.version+1
      FROM mps_weekly_plans weekly
      WHERE weekly.tenant_id=child.tenant_id AND weekly.id=child.weekly_plan_id
        AND (child.division_id,child.order_number,child.item_code,child.item_name,child.delivery_number)
          IS DISTINCT FROM (weekly.division_id,weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number);

      UPDATE mps_process_reports child SET
        division_id=weekly.division_id,order_number=weekly.order_number,item_code=weekly.item_code,
        item_name=weekly.item_name,delivery_number=weekly.delivery_number,
        planned_quantity=weekly.planned_quantity,
        updated_at=now(),updated_by='${systemUserId}'::uuid,version=child.version+1
      FROM mps_weekly_plans weekly
      WHERE weekly.tenant_id=child.tenant_id AND weekly.id=child.weekly_plan_id
        AND (child.division_id,child.order_number,child.item_code,child.item_name,child.delivery_number,child.planned_quantity)
          IS DISTINCT FROM (weekly.division_id,weekly.order_number,weekly.item_code,weekly.item_name,weekly.delivery_number,weekly.planned_quantity);

      ALTER TABLE mps_technical_reports
        ADD CONSTRAINT uq_mps_technical_weekly UNIQUE(tenant_id,weekly_plan_id);
      ALTER TABLE mps_material_reports
        ADD CONSTRAINT uq_mps_material_weekly UNIQUE(tenant_id,weekly_plan_id,material_name);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE mps_material_reports DROP CONSTRAINT IF EXISTS uq_mps_material_weekly;
      ALTER TABLE mps_technical_reports DROP CONSTRAINT IF EXISTS uq_mps_technical_weekly;

      ALTER TABLE mps_technical_reports
        ADD CONSTRAINT uq_mps_technical_report UNIQUE(tenant_id,order_number,item_code,delivery_number);
      ALTER TABLE mps_material_reports
        ADD CONSTRAINT uq_mps_material_report UNIQUE(tenant_id,order_number,item_code,delivery_number,material_name);
      ALTER TABLE mps_outsourcing_reports
        ADD CONSTRAINT uq_mps_outsourcing_report UNIQUE(tenant_id,order_number,item_code,delivery_number);

      ALTER TABLE mps_weekly_plans ALTER COLUMN base_plan_id DROP NOT NULL;
      DELETE FROM mps_data_exceptions
      WHERE exception_type='WEEKLY_CHILD_DUPLICATE_REPAIRED'
        AND exception_key LIKE 'weekly-child-duplicate:%';
    `);
  }
}
