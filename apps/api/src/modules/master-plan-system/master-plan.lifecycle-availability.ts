import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { mpsLifecycleOperations, mpsLifecycleResources, type MpsLifecycleAvailability, type MpsLifecycleOperation } from '@kdos/contracts';
import type { EntityManager } from 'typeorm';

type TriggerRequirement = { phase: string; table_name: string; trigger_name: string; function_name: string };
const planTables = ['mps_monthly_plans', 'mps_base_plans', 'mps_weekly_plans'];
const factTables = ['mps_process_reports', 'mps_technical_reports', 'mps_material_reports', 'mps_outsourcing_reports', 'mps_three_day_work_orders'];
const taskTables = [...factTables.slice(1), 'mps_weekly_process_plans'];
const triggers: TriggerRequirement[] = [
    ...planTables.map(table_name => ({ phase: 'schema', table_name, trigger_name: 'aa_mps_plan_lifecycle', function_name: 'mps_guard_plan_lifecycle()' })),
    ...[...factTables, 'mps_weekly_process_plans'].map(table_name => ({ phase: 'schema', table_name, trigger_name: 'aa_mps_lifecycle_execution', function_name: 'mps_guard_lifecycle_execution()' })),
    ...[...planTables, 'mps_shipping_plans', 'mps_order_allocations'].map(table_name => ({ phase: 'protection', table_name, trigger_name: 'trg_mps_executed_identity', function_name: 'mps_guard_executed_plan_identity()' })),
    ...factTables.map(table_name => ({ phase: 'protection', table_name, trigger_name: 'trg_mps_execution_parent_fence', function_name: 'mps_execution_parent_fence()' })),
    ...taskTables.filter(t => t !== 'mps_weekly_process_plans').map(table_name => ({ phase: 'protection', table_name, trigger_name: 'trg_mps_executed_task', function_name: 'mps_guard_executed_task()' })),
    { phase: 'protection', table_name: 'mps_weekly_process_plans', trigger_name: 'zz_mps_executed_process_identity', function_name: 'mps_guard_executed_task()' },
    { phase: 'protection', table_name: 'mps_process_reports', trigger_name: 'trg_mps_report_context', function_name: 'mps_guard_report_context()' },
    { phase: 'protection', table_name: 'mps_weekly_process_plans', trigger_name: 'trg_mps_weekly_process_config_guard', function_name: 'mps_guard_weekly_process_config()' },
    { phase: 'protection', table_name: 'mps_process_reports', trigger_name: 'trg_mps_process_report_locks_process_config', function_name: 'mps_lock_weekly_process_config_after_report()' }
];

/** One catalog-only snapshot. Missing/partial migrations never cause a business-column query. */
export async function readMpsLifecycleAvailability(db: Pick<EntityManager, 'query'>, resource: string): Promise<MpsLifecycleAvailability> {
    let row: { schema_ready: boolean; protection_ready: boolean } | undefined;
    try {
        [row] = await db.query(`WITH plans AS (SELECT unnest($1::text[]) table_name),
          required_triggers AS (SELECT * FROM jsonb_to_recordset($2::jsonb)
            AS r(phase text,table_name text,trigger_name text,function_name text)),
          trigger_checks AS (SELECT r.phase,EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid=to_regclass(r.table_name) AND t.tgname=r.trigger_name AND NOT t.tgisinternal
              AND t.tgenabled IN ('O','A') AND t.tgfoid=to_regprocedure(r.function_name)) ready FROM required_triggers r)
          SELECT NOT EXISTS(SELECT 1 FROM plans p WHERE
            NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
              WHERE a.attrelid=to_regclass(p.table_name) AND a.attname='lifecycle_status' AND NOT a.attisdropped
                AND a.attnotnull AND a.atttypid='varchar'::regtype AND a.atttypmod>=28
                AND pg_get_expr(d.adbin,d.adrelid)='''ACTIVE''::character varying')
            OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=to_regclass(p.table_name)
              AND c.conname='ck_'||p.table_name||'_lifecycle' AND c.contype='c' AND c.convalidated)
            OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=to_regclass(p.table_name)
              AND i.indexrelid=to_regclass('ix_'||p.table_name||'_lifecycle') AND i.indisvalid AND i.indisready))
            AND to_regprocedure('mps_weekly_lifecycle_execution_allowed(character varying,uuid)') IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM trigger_checks WHERE phase='schema' AND NOT ready) AS schema_ready,
          to_regprocedure('mps_execution_content(text,jsonb)') IS NOT NULL
            AND to_regprocedure('mps_weekly_has_execution(character varying,uuid)') IS NOT NULL
            AND NOT EXISTS(SELECT 1 FROM trigger_checks WHERE phase='protection' AND NOT ready) AS protection_ready`,
        [planTables, JSON.stringify(triggers)]);
    } catch {
        throw new ServiceUnavailableException({ code: 'MPS_LIFECYCLE_CAPABILITY_UNAVAILABLE', message: '计划状态操作的服务检查暂不可用，请稍后重试' });
    }
    const schemaReady = row?.schema_ready === true;
    const serviceReady = row?.protection_ready === true && Boolean(process.env.JWT_ACCESS_SECRET?.trim());
    const writesEnabled = process.env.KDOS_MPS_LIFECYCLE_WRITES_ENABLED === 'true';
    const previewAvailable = schemaReady && serviceReady;
    const planResource = (mpsLifecycleResources as readonly string[]).includes(resource);
    const operations = Object.fromEntries((Object.keys(mpsLifecycleOperations) as MpsLifecycleOperation[]).map(operation => {
        // Parent cancellation consumers remain unfinished; record-specific restrictions still run in inspect().
        const writeSupported = planResource && (resource === 'mps-weekly-plans' || !['CANCEL', 'CANCEL_REMAINING'].includes(operation));
        return [operation, { previewAvailable: previewAvailable && planResource, writeSupported, confirmEnabled: previewAvailable && writesEnabled && writeSupported }];
    })) as MpsLifecycleAvailability['operations'];
    return {
        schemaReady, serviceReady, writesEnabled, previewAvailable,
        historicalCorrectionAvailable: previewAvailable,
        unavailableReason: !schemaReady ? '计划状态操作尚未发布，暂不开放' : !serviceReady ? '计划状态操作的安全保护或签名服务尚未就绪' : null,
        operations
    };
}

export function requireMpsLifecycleAvailable(availability: MpsLifecycleAvailability): void {
    if (!availability.previewAvailable) throw new ConflictException({
        code: !availability.schemaReady ? 'MPS_LIFECYCLE_SCHEMA_UNAVAILABLE' : 'MPS_LIFECYCLE_SERVICE_UNAVAILABLE',
        message: availability.unavailableReason
    });
}
