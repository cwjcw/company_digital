import { MigrationInterface, QueryRunner } from "typeorm";

export class DevelopmentRequests1722920019000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE "development_request_number_seq" START 1`);
    await queryRunner.query(`
      CREATE TABLE "development_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "request_number" varchar NOT NULL UNIQUE,
        "title" varchar(200) NOT NULL,
        "category" varchar(50) NOT NULL,
        "description" text NOT NULL,
        "business_value" text,
        "urgency" varchar(20) NOT NULL DEFAULT 'NORMAL',
        "desired_date" date,
        "status" varchar(50) NOT NULL,
        "requester_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "requester_manager_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "handler_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "handler_manager_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
        "required_resources" text,
        "estimated_workdays" numeric(8,2),
        "planned_completion_date" date,
        "requester_approved_at" timestamptz,
        "assigned_at" timestamptz,
        "plan_submitted_at" timestamptz,
        "handler_manager_approved_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" varchar NOT NULL DEFAULT 'system',
        CONSTRAINT "CK_development_request_estimated_workdays" CHECK ("estimated_workdays" IS NULL OR "estimated_workdays" > 0),
        CONSTRAINT "CK_development_request_distinct_requester_manager" CHECK ("requester_id" <> "requester_manager_id"),
        CONSTRAINT "CK_development_request_distinct_handler_manager" CHECK ("handler_id" IS NULL OR "handler_manager_id" IS NULL OR "handler_id" <> "handler_manager_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_development_requests_status_updated" ON "development_requests" ("status", "updated_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_development_requests_requester" ON "development_requests" ("requester_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_development_requests_requester_manager" ON "development_requests" ("requester_manager_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_development_requests_handler" ON "development_requests" ("handler_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_development_requests_handler_manager" ON "development_requests" ("handler_manager_id")`);
    await queryRunner.query(`
      CREATE TABLE "development_request_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "request_id" uuid NOT NULL REFERENCES "development_requests"("id") ON DELETE CASCADE,
        "actor_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "actor_name" varchar NOT NULL,
        "action" varchar(50) NOT NULL,
        "from_status" varchar,
        "to_status" varchar NOT NULL,
        "comment" text,
        "snapshot" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" varchar NOT NULL DEFAULT 'system'
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_development_request_events_request_created" ON "development_request_events" ("request_id", "created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "development_request_events"`);
    await queryRunner.query(`DROP INDEX "IDX_development_requests_handler_manager"`);
    await queryRunner.query(`DROP INDEX "IDX_development_requests_handler"`);
    await queryRunner.query(`DROP INDEX "IDX_development_requests_requester_manager"`);
    await queryRunner.query(`DROP INDEX "IDX_development_requests_requester"`);
    await queryRunner.query(`DROP INDEX "IDX_development_requests_status_updated"`);
    await queryRunner.query(`DROP TABLE "development_requests"`);
    await queryRunner.query(`DROP SEQUENCE "development_request_number_seq"`);
  }
}
