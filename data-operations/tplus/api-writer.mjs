export async function writeOrderSnapshot(config, orders) {
  const response = await fetch(`${config.apiUrl}/data-operations/tplus/sales-orders/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.apiKey },
    body: JSON.stringify({ beginDate: config.beginDate, sourceDatabases: config.sourceDatabases, orders }),
    signal: AbortSignal.timeout(180_000)
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const detail = Array.isArray(body?.message) ? body.message.join("；") : body?.message || response.statusText;
    throw new Error(`写入 API 失败（HTTP ${response.status}）：${detail}`);
  }
  return body;
}
