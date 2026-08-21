// Compatibility module for a browser tab that still references a monthly-plan
// chunk from an older deployment. The refreshed HTML points at the current app.
window.location.reload();

export function MonthlyPlanPage() {
  return null;
}

export default MonthlyPlanPage;
