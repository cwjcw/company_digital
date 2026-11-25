import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnifiedBomQueryService } from './unified-bom.query.service';
import { allocationBomDecision, type AllocationBomState } from './rd-allocation-bom-state';
import { waitingDays } from './rd-order-bom-report.calculator';

export const allocationBomGate = (tenant: string) => `rd-allocation-bom:${tenant}`;
@Injectable()
export class RdAllocationBomService {
  constructor(private readonly db: DataSource, private readonly unified: UnifiedBomQueryService) {}

  /** Explicit release boundary; never enables on a report read or process restart. */
  async activate(tenant: string) {
    return this.db.transaction(async m => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      await m.query('LOCK TABLE mps_order_allocations IN SHARE ROW EXCLUSIVE MODE');
      await m.query('INSERT INTO rd_allocation_bom_capture(tenant_id) VALUES($1) ON CONFLICT DO NOTHING',[tenant]);
      const [capture] = await m.query(`WITH changed AS (UPDATE rd_allocation_bom_capture SET enabled=true,
        activated_at=COALESCE(activated_at,clock_timestamp()),historical_count=CASE WHEN activated_at IS NULL
        THEN (SELECT count(*) FROM rd_allocation_bom_state WHERE tenant_id=$1 AND NOT initial_capture_eligible) ELSE historical_count END
        WHERE tenant_id=$1 RETURNING activated_at,historical_count) SELECT * FROM changed`,[tenant]);
      return capture;
    });
  }

  /** Existing minute consumer and successful index commands share this durable queue. */
  async processPending(tenant: string, limit = 500) {
    return this.db.transaction('REPEATABLE READ',async m => {
      await m.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
      const [gate] = await m.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) locked',[allocationBomGate(tenant)]);
      if (!gate.locked) return {processed:0,deferred:'BATCH_IN_PROGRESS'};
      const [capture] = await m.query('SELECT enabled FROM rd_allocation_bom_capture WHERE tenant_id=$1',[tenant]);
      if (!capture?.enabled) return {processed:0,deferred:'NOT_ACTIVATED'};
      const rows: Array<AllocationBomState & {allocation_id:string;order_date:string|null;item_code:string;version:number}> = await m.query(`SELECT s.*,s.allocation_date::text allocation_date,a.order_date::text order_date,a.item_code
        FROM rd_allocation_bom_state s JOIN mps_order_allocations a ON a.tenant_id=s.tenant_id AND a.id=s.allocation_id
        WHERE s.tenant_id=$1 AND s.pending AND a.archived_at IS NULL AND a.order_status='已审核'
          AND (s.last_attempt_at IS NULL OR s.last_attempt_at<now()-interval '30 seconds')
        ORDER BY s.last_attempt_at NULLS FIRST,s.allocation_id LIMIT $2 FOR UPDATE OF s`,[tenant,Math.min(2000,Math.max(1,limit))]);
      if (!rows.length) return {processed:0};
      const snapshot = await this.unified.readSnapshot(m,tenant,[...new Set(rows.map(r=>r.item_code))]);
      const [{instant,business_day:day}] = await m.query("SELECT clock_timestamp()::text instant,(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date::text business_day");
      if (!snapshot.enabled) {
        await m.query(`UPDATE rd_allocation_bom_state SET last_attempt_at=$3,last_error=$4,updated_at=now()
          WHERE tenant_id=$1 AND allocation_id=ANY($2::uuid[])`,[tenant,rows.map(r=>r.allocation_id),instant,'INDEX_NOT_INITIALIZED']);
        return {processed:rows.length,deferred:'SOURCE_NOT_RELIABLE'};
      }
      let deferred=false;
      for (const row of rows) {
        const matched=snapshot.match(row.item_code);
        const confirmedY=snapshot.matchReliable(row.item_code).status==='HAS_BOM';
        if (!confirmedY && !snapshot.verified) {
          deferred=true;
          await m.query("UPDATE rd_allocation_bom_state SET last_attempt_at=$3,last_error='SOURCE_NOT_RELIABLE',updated_at=now() WHERE tenant_id=$1 AND allocation_id=$2",[tenant,row.allocation_id,instant]);
          continue;
        }
        const status=confirmedY?'Y':'N';
        const legacy=waitingDays(row.order_date,matched.approvalDate,day,matched.status).bom;
        const d=allocationBomDecision(row,status,day,legacy);
        const evidence=JSON.stringify({sources:snapshot.evidence,observationAt:instant,itemCode:row.item_code,
          effectiveBomSources:snapshot.matchReliable(row.item_code).bomSources,status,fullyVerified:snapshot.verified,
          method:status==='Y'?'RELIABLE_POSITIVE_SOURCE':'THREE_VERIFIED_ABSENCES'});
        await m.query(`UPDATE rd_allocation_bom_state SET
          initial_bom_status=CASE WHEN $4 THEN $3 ELSE initial_bom_status END,
          initial_bom_checked_at=CASE WHEN $4 THEN $5::timestamptz ELSE initial_bom_checked_at END,
          initial_capture_delay_seconds=CASE WHEN $4 THEN GREATEST(0,EXTRACT(EPOCH FROM ($5::timestamptz-first_eligible_at)))::integer ELSE initial_capture_delay_seconds END,
          current_bom_status=$3,
          first_completed_at=CASE WHEN $6 THEN COALESCE(first_completed_at,$5::timestamptz) ELSE first_completed_at END,
          first_completed_date=CASE WHEN $6 THEN COALESCE(first_completed_date,$7::date) ELSE first_completed_date END,
          first_completed_waiting_days=CASE WHEN $6 AND first_completed_at IS NULL THEN $8::integer ELSE first_completed_waiting_days END,
          latest_completed_at=CASE WHEN $6 THEN $5::timestamptz ELSE latest_completed_at END,
          latest_completed_date=CASE WHEN $6 THEN $7::date ELSE latest_completed_date END,
          locked_waiting_days=$8::integer,
          waiting_basis=CASE WHEN $6 THEN 'ALLOCATION_OBSERVATION' WHEN $9 AND $3='Y' THEN CASE WHEN $8::integer IS NULL THEN 'LEGACY_UNKNOWN' ELSE 'LEGACY_ORDER_APPROVAL' END ELSE waiting_basis END,
          last_status_changed_at=CASE WHEN $10 THEN $5::timestamptz ELSE last_status_changed_at END,
          last_checked_at=$5::timestamptz,last_attempt_at=$5::timestamptz,last_error=NULL,pending=false,last_evidence=$11::jsonb,
          version=version+CASE WHEN $12 THEN 1 ELSE 0 END,updated_at=now()
          WHERE tenant_id=$1 AND allocation_id=$2`,[tenant,row.allocation_id,status,d.initial,instant,d.completion,day,d.locked,d.baseline,d.changed,evidence,!!d.event]);
        if (d.event) await m.query(`INSERT INTO rd_allocation_bom_history(tenant_id,allocation_id,state_version,previous_status,bom_status,observed_at,observed_date,waiting_days,event_kind,evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[tenant,row.allocation_id,row.version+1,row.current_bom_status,status,instant,day,d.locked,d.event,evidence]);
      }
      return {processed:rows.length,...(deferred?{deferred:'SOURCE_NOT_RELIABLE'}:{})};
    });
  }

  async drain(tenant: string) {
    let processed=0;
    for (let page=0;page<100;page++) {
      const result=await this.processPending(tenant,1000);processed+=result.processed;
      if (!result.processed || result.deferred) return {processed,deferred:result.deferred??null};
    }
    return {processed,deferred:'CONTINUES_IN_EXISTING_CONSUMER'};
  }
}
