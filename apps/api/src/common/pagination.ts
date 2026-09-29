/** KDOS 标准业务表统一分页约束。业务模块不得另行声明一套页大小白名单。 */
export const kdosPageSizeOptions = [50, 100, 200, 500, 1000] as const;
export const kdosDefaultPageSize = 100;

export function normalizeKdosPageSize(value: unknown, fallback = kdosDefaultPageSize) {
  const requested = Math.floor(Number(value));
  return kdosPageSizeOptions.includes(requested as (typeof kdosPageSizeOptions)[number]) ? requested : fallback;
}
