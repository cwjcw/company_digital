import { buildDataScopeClause } from '../../common/filtering/data-scope';
import type { TableFilterActor } from '../../common/filtering/table-filter.registry';
import { progressColumns } from './pmc-rd-progress.columns';
import { resourceCode } from './pmc-rd-progress.types';
export function progressScope(actor: TableFilterActor, params: unknown[], action = 'read') {
  // NONE never grants a report read; malformed CUSTOM grants fail closed as a unit.
  const tableDataScopes=(actor.tableDataScopes ?? []).filter(scope => scope.scope !== 'NONE' && (scope.scope !== 'CUSTOM' || (scope.rules?.length && scope.rules.every(rule => progressColumns[String(rule.fieldKey)] && ['EQ','NE','GT','GTE','LT','LTE','IN','NOT_IN','IS_EMPTY','IS_NOT_EMPTY','CONTAINS','NOT_CONTAINS','STARTS_WITH'].includes(String(rule.operator)) && (['IS_EMPTY','IS_NOT_EMPTY'].includes(String(rule.operator)) || rule.value != null)))));
  return buildDataScopeClause({resource:resourceCode,action,columns:progressColumns,actor:{...actor,tableDataScopes},params});
}
