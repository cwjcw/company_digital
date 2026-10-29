import { BadRequestException } from "@nestjs/common";
import type { EntityManager } from "typeorm";

/** One allocator for manual/import creation and automatic plan creation. Numbers are never reused. */
export async function nextMasterPlanDeliveryCode(manager: Pick<EntityManager, "query">, tenantId: string, orderNumber: string, itemCode: string, actorId: string) {
  await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`mps-delivery-code:${tenantId}:${orderNumber}:${itemCode}`]);
  const [counter] = await manager.query(`
    INSERT INTO mps_delivery_code_counters(tenant_id,order_number,item_code,next_number,created_by,updated_by)
    VALUES($1,$2,$3,2,$4::uuid,$4)
    ON CONFLICT(tenant_id,order_number,item_code) DO UPDATE SET
      next_number=mps_delivery_code_counters.next_number+1,updated_at=now(),updated_by=$4
    RETURNING next_number-1 AS generated
  `, [tenantId, orderNumber, itemCode, actorId]);
  const generated = String(counter?.generated ?? "");
  if (!/^\d+$/.test(generated) || BigInt(generated) < 1n) throw new BadRequestException("系统无法生成有效的交期编码");
  return generated.padStart(3, "0");
}
