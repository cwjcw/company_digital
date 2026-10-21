import type { MigrationInterface, QueryRunner } from "typeorm";

/** Broaden only the mapping source; scheduled import runs still accept their original two sources. */
export class FinanceCustomerManualSource1722920103000 implements MigrationInterface {
    name = "FinanceCustomerManualSource1722920103000";
    async up(r: QueryRunner) {
        await r.query(`ALTER TABLE finance_customer_mappings ADD CONSTRAINT finance_customer_mappings_source_manual_check
            CHECK(source IN ('INITIAL_IMPORT','E10_SYNC','MANUAL')) NOT VALID`);
        await r.query("ALTER TABLE finance_customer_mappings VALIDATE CONSTRAINT finance_customer_mappings_source_manual_check");
        await r.query("ALTER TABLE finance_customer_mappings DROP CONSTRAINT finance_customer_mappings_source_check");
        await r.query("ALTER TABLE finance_customer_mappings RENAME CONSTRAINT finance_customer_mappings_source_manual_check TO finance_customer_mappings_source_check");
    }
    async down() { throw new Error("Manual finance customers must be retained; roll back the application without narrowing source values."); }
}
