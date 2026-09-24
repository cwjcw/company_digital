export type LifecycleStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ABORTED";
export type DisplayStatus = "NORMAL" | "OVERDUE" | "COMPLETED" | "ABORTED";
export type CompletionTimeliness = "ON_TIME" | "LATE" | null;

export function shanghaiDate(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function supervisionDisplayStatus(lifecycleStatus: LifecycleStatus, dueDate: string, now: Date | string = new Date()): DisplayStatus {
  if (lifecycleStatus === "COMPLETED") return "COMPLETED";
  if (lifecycleStatus === "ABORTED") return "ABORTED";
  return dueDate < shanghaiDate(now) ? "OVERDUE" : "NORMAL";
}

export function completionTimeliness(lifecycleStatus: LifecycleStatus, dueDate: string, completedAt: Date | string | null): CompletionTimeliness {
  if (lifecycleStatus !== "COMPLETED" || !completedAt) return null;
  return shanghaiDate(completedAt) <= dueDate ? "ON_TIME" : "LATE";
}

function daysBetween(from: string, to: string) {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

export type PerformanceTask = { lifecycleStatus: LifecycleStatus; dueDate: string; completedAt: Date | string | null };
export function aggregateOwnerPerformance(tasks: PerformanceTask[], asOf: Date | string = new Date()) {
  const currentDate = shanghaiDate(asOf);
  const aborted = tasks.filter((task) => task.lifecycleStatus === "ABORTED").length;
  const effective = tasks.filter((task) => task.lifecycleStatus !== "ABORTED");
  const onTimeCompleted = effective.filter((task) => completionTimeliness(task.lifecycleStatus, task.dueDate, task.completedAt) === "ON_TIME").length;
  const lateCompletedTasks = effective.filter((task) => completionTimeliness(task.lifecycleStatus, task.dueDate, task.completedAt) === "LATE");
  const currentlyOverdueTasks = effective.filter((task) => task.lifecycleStatus !== "COMPLETED" && task.dueDate < currentDate);
  const notDueIncomplete = effective.filter((task) => task.lifecycleStatus !== "COMPLETED" && task.dueDate >= currentDate).length;
  const delayDays = [
    ...lateCompletedTasks.map((task) => daysBetween(task.dueDate, shanghaiDate(task.completedAt!))),
    ...currentlyOverdueTasks.map((task) => daysBetween(task.dueDate, currentDate))
  ];
  const totalTasks = effective.length;
  return {
    totalTasks, onTimeCompleted, lateCompleted: lateCompletedTasks.length,
    currentlyOverdue: currentlyOverdueTasks.length, overdueTasks: lateCompletedTasks.length + currentlyOverdueTasks.length,
    notDueIncomplete, aborted, onTimeRate: totalTasks ? Number(((onTimeCompleted / totalTasks) * 100).toFixed(2)) : 0,
    averageDelayDays: delayDays.length ? Number((delayDays.reduce((sum, value) => sum + value, 0) / delayDays.length).toFixed(2)) : 0
  };
}
