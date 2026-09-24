import { MigrationInterface, QueryRunner } from "typeorm";

/** KDOS-PROJECT-TASK-SUPERVISION-001：任务督办第一阶段；不包含订单项目管理。 */
export class ProjectTaskSupervision1722920071000 implements MigrationInterface {
  name = "ProjectTaskSupervision1722920071000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE audit_logs ADD COLUMN tenant_id varchar(64) NULL`);
    await queryRunner.query(`CREATE INDEX idx_audit_logs_tenant_resource_time ON audit_logs(tenant_id,resource,created_at DESC)`);
    await queryRunner.query(`
      CREATE TABLE supervision_projects (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        project_code varchar(40) NOT NULL,
        project_name varchar(300) NOT NULL,
        source_type varchar(40) NULL,
        source_name varchar(300) NULL,
        source_date date NULL,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        supervisor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        department_id uuid NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        participant_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        priority varchar(20) NOT NULL DEFAULT 'MEDIUM',
        planned_start_date date NOT NULL,
        due_date date NOT NULL,
        lifecycle_status varchar(30) NOT NULL DEFAULT 'NOT_STARTED',
        acceptance_criteria text NOT NULL,
        completion_summary text NULL,
        stop_reason text NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        completed_at timestamptz NULL,
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_supervision_projects_code UNIQUE(tenant_id,project_code),
        CONSTRAINT uq_supervision_projects_tenant_id UNIQUE(tenant_id,id),
        CONSTRAINT ck_supervision_projects_name CHECK(btrim(project_name)<>''),
        CONSTRAINT ck_supervision_projects_acceptance CHECK(btrim(acceptance_criteria)<>''),
        CONSTRAINT ck_supervision_projects_dates CHECK(planned_start_date<=due_date),
        CONSTRAINT ck_supervision_projects_source CHECK(source_type IS NULL OR source_type IN ('IMPORTANT_MEETING','STRATEGIC_TASK','LEADER_ASSIGNMENT','SPECIAL_WORK','OTHER')),
        CONSTRAINT ck_supervision_projects_priority CHECK(priority IN ('URGENT','HIGH','MEDIUM','LOW')),
        CONSTRAINT ck_supervision_projects_lifecycle CHECK(lifecycle_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','ABORTED')),
        CONSTRAINT ck_supervision_projects_completed CHECK((lifecycle_status='COMPLETED')=(completed_at IS NOT NULL)),
        CONSTRAINT ck_supervision_projects_stopped CHECK(lifecycle_status<>'ABORTED' OR NULLIF(btrim(stop_reason),'') IS NOT NULL),
        CONSTRAINT ck_supervision_projects_participants CHECK(jsonb_typeof(participant_ids)='array'),
        CONSTRAINT ck_supervision_projects_attachments CHECK(jsonb_typeof(attachments)='array'),
        CONSTRAINT ck_supervision_projects_version CHECK(version>0)
      );
      CREATE INDEX idx_supervision_projects_owner ON supervision_projects(tenant_id,owner_id);
      CREATE INDEX idx_supervision_projects_supervisor ON supervision_projects(tenant_id,supervisor_id);
      CREATE INDEX idx_supervision_projects_department ON supervision_projects(tenant_id,department_id);
      CREATE INDEX idx_supervision_projects_due ON supervision_projects(tenant_id,due_date,lifecycle_status);
      CREATE INDEX idx_supervision_projects_participants ON supervision_projects USING gin(participant_ids);
    `);
    await queryRunner.query(`
      CREATE TABLE supervision_tasks (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        task_code varchar(40) NOT NULL,
        project_id uuid NOT NULL,
        task_name varchar(300) NOT NULL,
        description text NULL,
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        collaborator_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        department_id uuid NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
        priority varchar(20) NOT NULL DEFAULT 'MEDIUM',
        planned_start_date date NULL,
        due_date date NOT NULL,
        lifecycle_status varchar(30) NOT NULL DEFAULT 'NOT_STARTED',
        progress numeric(5,2) NOT NULL DEFAULT 0,
        acceptance_criteria text NOT NULL,
        next_followup_date date NULL,
        completed_at timestamptz NULL,
        stop_reason text NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT uq_supervision_tasks_code UNIQUE(tenant_id,task_code),
        CONSTRAINT uq_supervision_tasks_tenant_id_project UNIQUE(tenant_id,id,project_id),
        CONSTRAINT fk_supervision_tasks_project FOREIGN KEY(tenant_id,project_id) REFERENCES supervision_projects(tenant_id,id) ON DELETE RESTRICT,
        CONSTRAINT ck_supervision_tasks_name CHECK(btrim(task_name)<>''),
        CONSTRAINT ck_supervision_tasks_acceptance CHECK(btrim(acceptance_criteria)<>''),
        CONSTRAINT ck_supervision_tasks_dates CHECK(planned_start_date IS NULL OR planned_start_date<=due_date),
        CONSTRAINT ck_supervision_tasks_priority CHECK(priority IN ('URGENT','HIGH','MEDIUM','LOW')),
        CONSTRAINT ck_supervision_tasks_lifecycle CHECK(lifecycle_status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','ABORTED')),
        CONSTRAINT ck_supervision_tasks_progress CHECK(progress>=0 AND progress<=100),
        CONSTRAINT ck_supervision_tasks_completed CHECK((lifecycle_status='COMPLETED')=(completed_at IS NOT NULL)),
        CONSTRAINT ck_supervision_tasks_stopped CHECK(lifecycle_status<>'ABORTED' OR NULLIF(btrim(stop_reason),'') IS NOT NULL),
        CONSTRAINT ck_supervision_tasks_collaborators CHECK(jsonb_typeof(collaborator_ids)='array'),
        CONSTRAINT ck_supervision_tasks_attachments CHECK(jsonb_typeof(attachments)='array'),
        CONSTRAINT ck_supervision_tasks_version CHECK(version>0)
      );
      CREATE INDEX idx_supervision_tasks_project ON supervision_tasks(tenant_id,project_id);
      CREATE INDEX idx_supervision_tasks_owner ON supervision_tasks(tenant_id,owner_id);
      CREATE INDEX idx_supervision_tasks_department ON supervision_tasks(tenant_id,department_id);
      CREATE INDEX idx_supervision_tasks_due ON supervision_tasks(tenant_id,due_date,lifecycle_status);
      CREATE INDEX idx_supervision_tasks_collaborators ON supervision_tasks USING gin(collaborator_ids);
    `);
    await queryRunner.query(`
      CREATE TABLE supervision_task_progress (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        tenant_id varchar(64) NOT NULL,
        task_id uuid NOT NULL,
        project_id uuid NOT NULL,
        update_type varchar(30) NOT NULL,
        progress numeric(5,2) NULL,
        summary text NOT NULL,
        risk_issue text NULL,
        next_action text NULL,
        next_followup_date date NULL,
        proposed_due_date date NULL,
        change_reason text NULL,
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_by varchar NOT NULL DEFAULT 'system',
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1,
        CONSTRAINT fk_supervision_progress_task FOREIGN KEY(tenant_id,task_id,project_id) REFERENCES supervision_tasks(tenant_id,id,project_id) ON DELETE RESTRICT,
        CONSTRAINT fk_supervision_progress_project FOREIGN KEY(tenant_id,project_id) REFERENCES supervision_projects(tenant_id,id) ON DELETE RESTRICT,
        CONSTRAINT ck_supervision_progress_type CHECK(update_type IN ('PROGRESS','RISK','DUE_DATE_CHANGE','COMPLETION')),
        CONSTRAINT ck_supervision_progress_value CHECK(progress IS NULL OR (progress>=0 AND progress<=100)),
        CONSTRAINT ck_supervision_progress_summary CHECK(btrim(summary)<>''),
        CONSTRAINT ck_supervision_progress_due_change CHECK(update_type<>'DUE_DATE_CHANGE' OR (proposed_due_date IS NOT NULL AND NULLIF(btrim(change_reason),'') IS NOT NULL)),
        CONSTRAINT ck_supervision_progress_attachments CHECK(jsonb_typeof(attachments)='array'),
        CONSTRAINT ck_supervision_progress_version CHECK(version>0)
      );
      CREATE INDEX idx_supervision_progress_task_time ON supervision_task_progress(tenant_id,task_id,created_at DESC,id DESC);
      CREATE INDEX idx_supervision_progress_project_time ON supervision_task_progress(tenant_id,project_id,created_at DESC,id DESC);
    `);
    for (const table of ["supervision_projects", "supervision_tasks", "supervision_task_progress"]) {
      await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`CREATE POLICY ${table}_tenant_policy ON ${table}
        USING (tenant_id=current_setting('app.tenant_id',true))
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS supervision_task_progress`);
    await queryRunner.query(`DROP TABLE IF EXISTS supervision_tasks`);
    await queryRunner.query(`DROP TABLE IF EXISTS supervision_projects`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_logs_tenant_resource_time`);
    await queryRunner.query(`ALTER TABLE audit_logs DROP COLUMN IF EXISTS tenant_id`);
  }
}
