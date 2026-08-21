import { MigrationInterface, QueryRunner } from "typeorm";

export class ApprovalFlowConfigs1722920021000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "approval_flow_configs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "flow_key" varchar(100) NOT NULL,
        "name" varchar(100) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "allow_draft" boolean NOT NULL DEFAULT true,
        "allow_withdraw" boolean NOT NULL DEFAULT true,
        "return_mode" varchar(30) NOT NULL DEFAULT 'ANY_PREVIOUS',
        "reject_target_mode" varchar(30) NOT NULL DEFAULT 'DRAFT',
        "approval_comment_required" boolean NOT NULL DEFAULT false,
        "admin_role_names" jsonb NOT NULL DEFAULT '["系统管理员","集团管理员"]'::jsonb,
        "node_labels" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "updated_by" varchar NOT NULL DEFAULT 'system',
        CONSTRAINT "PK_approval_flow_configs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_approval_flow_configs_flow_key" UNIQUE ("flow_key"),
        CONSTRAINT "CHK_approval_flow_configs_return_mode" CHECK ("return_mode" IN ('ANY_PREVIOUS', 'PREVIOUS_ONLY')),
        CONSTRAINT "CHK_approval_flow_configs_reject_target_mode" CHECK ("reject_target_mode" IN ('DRAFT', 'PREVIOUS')),
        CONSTRAINT "CHK_approval_flow_configs_admin_roles" CHECK (jsonb_typeof("admin_role_names") = 'array'),
        CONSTRAINT "CHK_approval_flow_configs_node_labels" CHECK (jsonb_typeof("node_labels") = 'object')
      )
    `);
    await queryRunner.query(`
      INSERT INTO "approval_flow_configs" (
        "flow_key", "name", "admin_role_names", "node_labels", "updated_by"
      ) VALUES (
        'development-request', '需求提报与审批',
        '["系统管理员","集团管理员"]'::jsonb,
        '{
          "DRAFT":"创建并填写",
          "PENDING_REQUESTER_APPROVAL":"填写人上级审批",
          "PENDING_ADMIN_ASSIGNMENT":"管理员分配",
          "PENDING_HANDLER_PLAN":"资源与工期评估",
          "PENDING_HANDLER_MANAGER_APPROVAL":"处理人上级审批",
          "APPROVED_FOR_DEVELOPMENT":"已批准开发"
        }'::jsonb,
        'migration:approval-flow-configs'
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "approval_flow_configs"`);
  }
}
