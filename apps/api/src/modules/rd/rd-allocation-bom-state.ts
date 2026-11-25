import { naturalDayDifference } from './rd-order-bom-report.calculator';
export type BomStatus = 'Y' | 'N';
export type AllocationBomState = {
  initial_capture_eligible: boolean; initial_bom_status: BomStatus | null; current_bom_status: BomStatus | null;
  allocation_date: string | null; locked_waiting_days: number | null;
};
/** Decisions are based on a verified observation, never ERP approval timestamps. */
export function allocationBomDecision(state: AllocationBomState, observed: BomStatus, day: string, legacyWaiting: number | null) {
  const initial = state.initial_capture_eligible && state.initial_bom_status == null;
  const baseline = state.current_bom_status == null;
  const changed = !baseline && state.current_bom_status !== observed;
  const completion = observed === 'Y' && (initial || (!baseline && changed));
  const locked = completion ? initial ? 0 : naturalDayDifference(state.allocation_date,day)
    : baseline && observed === 'Y' ? legacyWaiting : state.locked_waiting_days;
  return {initial,baseline,changed,completion,locked,
    event: baseline ? state.initial_capture_eligible ? 'INITIAL_OBSERVATION' : 'HISTORICAL_BASELINE' : changed ? 'STATUS_CHANGED' : null};
}
export function allocationBomWaiting(state: Pick<AllocationBomState,'current_bom_status'|'allocation_date'|'locked_waiting_days'>, today: string) {
  return state.current_bom_status === 'N' ? naturalDayDifference(state.allocation_date,today)
    : state.current_bom_status === 'Y' ? state.locked_waiting_days : null;
}
