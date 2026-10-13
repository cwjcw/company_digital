import { Injectable, type OnModuleInit, BadRequestException } from "@nestjs/common";
import { FINANCE_CUSTOMER_RESOURCE, tablePermissionFieldsFor } from "@kdos/contracts";
import { TableFilterRegistry } from "../../common/filtering/table-filter.registry";
import { FinanceRepository } from "./finance.repository";
import { financeColumns, financeScope, financeAuthorize } from "./finance.types";
@Injectable()
export class FinanceFilterSourceProvider implements OnModuleInit {
    constructor(private readonly registry: TableFilterRegistry, private readonly repository: FinanceRepository) { }
    onModuleInit() {
        this.registry.register({ code: FINANCE_CUSTOMER_RESOURCE, table: "finance_customer_mappings", columns: financeColumns,
            fields: tablePermissionFieldsFor(FINANCE_CUSTOMER_RESOURCE), authorize: financeAuthorize, buildScope: financeScope,
            // All field predicates (including pending) use the platform FilterGroup compiler.
            buildContext: (context) => { if (Object.keys(context).length)
                throw new BadRequestException("客户对应表不接受额外上下文"); return "1=1"; },
            runQuery: (sql, params) => this.repository.query(sql, params),
            searchColumns: ["customerCode", "departmentCategory", "salesChannel"]
        });
    }
}
