export class PlanningNotFoundError extends Error {}
export class PlanningConflictError extends Error {
  constructor(message: string, readonly current?: unknown) { super(message); }
}
export class PlanningStateError extends Error {}
export class PlanningValidationError extends Error {
  constructor(message: string, readonly details?: unknown) { super(message); }
}
