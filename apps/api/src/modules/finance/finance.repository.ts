import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
@Injectable()
export class FinanceRepository {
    constructor(private readonly dataSource: DataSource) { }
    transaction<T>(tenant: string, command: (manager: EntityManager) => Promise<T>) {
        return this.dataSource.transaction(async (manager) => {
            await manager.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
            return command(manager);
        });
    }
    query(sql: string, params: unknown[]) { return this.transaction(String(params[0]), m => m.query(sql, params)); }
}
