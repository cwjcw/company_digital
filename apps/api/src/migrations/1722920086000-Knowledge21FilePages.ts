import { MigrationInterface, QueryRunner } from "typeorm";

/** Upgrade the existing single file store; preserve every file ID, key and published relation. */
export class Knowledge21FilePages1722920086000 implements MigrationInterface {
  name = "Knowledge21FilePages1722920086000";
  async up(r: QueryRunner) {
    await r.query(`ALTER TABLE knowledge_attachments RENAME TO knowledge_file_assets;
      ALTER TABLE knowledge_page_version_attachments RENAME TO knowledge_page_version_files;
      ALTER TABLE knowledge_page_version_files RENAME COLUMN attachment_id TO file_id;
      ALTER TABLE knowledge_file_assets DROP CONSTRAINT knowledge_attachments_size_check;
      ALTER TABLE knowledge_file_assets ADD CONSTRAINT knowledge_file_assets_size_check CHECK(size>0 AND size<=104857600);
      ALTER TABLE knowledge_file_assets ADD CONSTRAINT knowledge_file_assets_tenant_id UNIQUE(tenant_id,id);
      ALTER TABLE knowledge_pages ADD COLUMN content_mode varchar(20) NOT NULL DEFAULT 'RICH_TEXT' CHECK(content_mode IN ('RICH_TEXT','FILE')),
        ADD COLUMN description text NOT NULL DEFAULT '' CHECK(length(description)<=4000);
      ALTER TABLE knowledge_page_versions ADD COLUMN content_mode varchar(20) NOT NULL DEFAULT 'RICH_TEXT' CHECK(content_mode IN ('RICH_TEXT','FILE')),
        ADD COLUMN description text NOT NULL DEFAULT '' CHECK(length(description)<=4000);
      ALTER TABLE knowledge_page_version_files ADD COLUMN role varchar(20) NOT NULL DEFAULT 'SUPPLEMENTAL' CHECK(role IN ('PRIMARY','INLINE','SUPPLEMENTAL'));
      CREATE UNIQUE INDEX knowledge_version_primary_unique ON knowledge_page_version_files(tenant_id,version_id) WHERE role='PRIMARY';
      CREATE TABLE knowledge_page_files (
        id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,file_id uuid NOT NULL,
        role varchar(20) NOT NULL CHECK(role IN ('PRIMARY','INLINE','SUPPLEMENTAL')),
        created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_by varchar NOT NULL DEFAULT 'system',updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,page_id,file_id),
        FOREIGN KEY(tenant_id,page_id) REFERENCES knowledge_pages(tenant_id,id) ON DELETE CASCADE,
        FOREIGN KEY(tenant_id,page_id,file_id) REFERENCES knowledge_file_assets(tenant_id,page_id,id) ON DELETE CASCADE);
      CREATE UNIQUE INDEX knowledge_working_primary_unique ON knowledge_page_files(tenant_id,page_id) WHERE role='PRIMARY';
      INSERT INTO knowledge_page_files(tenant_id,page_id,file_id,role)
        SELECT tenant_id,page_id,id,CASE WHEN content_type LIKE 'image/%' THEN 'INLINE' ELSE 'SUPPLEMENTAL' END FROM knowledge_file_assets WHERE detached_at IS NULL;
      ALTER TABLE knowledge_file_assets DROP COLUMN detached_at;
      CREATE TABLE knowledge_file_previews (
        id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,file_id uuid NOT NULL,sha256 varchar(64) NOT NULL,
        converter_version varchar(100) NOT NULL, status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
        attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),retry_count integer NOT NULL DEFAULT 0 CHECK(retry_count>=0),error_reason varchar(1000),storage_key varchar(500) UNIQUE,
        size integer CHECK(size>0),lease_id uuid,lease_until timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,completed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES users(id),updated_by varchar NOT NULL DEFAULT 'system',version integer NOT NULL DEFAULT 1 CHECK(version>0),
        UNIQUE(tenant_id,file_id,sha256,converter_version),
        FOREIGN KEY(tenant_id,file_id) REFERENCES knowledge_file_assets(tenant_id,id) ON DELETE CASCADE);
      CREATE INDEX knowledge_file_previews_claim ON knowledge_file_previews(tenant_id,status,created_at);
      CREATE TABLE knowledge_file_upload_requests (
        id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
        idempotency_key uuid NOT NULL,request_hash varchar(64) NOT NULL,result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),created_by uuid REFERENCES users(id),updated_by varchar NOT NULL DEFAULT 'system',updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),UNIQUE(tenant_id,actor_id,idempotency_key));
      ALTER TABLE knowledge_page_files ENABLE ROW LEVEL SECURITY;
      CREATE POLICY knowledge_page_files_tenant ON knowledge_page_files USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE knowledge_file_previews ENABLE ROW LEVEL SECURITY;
      CREATE POLICY knowledge_file_previews_tenant ON knowledge_file_previews USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      ALTER TABLE knowledge_file_upload_requests ENABLE ROW LEVEL SECURITY;
      CREATE POLICY knowledge_file_upload_requests_tenant ON knowledge_file_upload_requests USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      CREATE OR REPLACE FUNCTION knowledge2_snapshot_file_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM knowledge_page_versions v WHERE v.tenant_id=NEW.tenant_id AND v.page_id=NEW.page_id AND v.id=NEW.version_id
          AND v.xmin::text::bigint=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
          RAISE EXCEPTION 'Published Knowledge file snapshots are immutable' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE FUNCTION knowledge21_primary_snapshot_check() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.content_mode='FILE' AND EXISTS(SELECT 1 FROM knowledge_page_versions v WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.id)
          AND (SELECT count(*) FROM knowledge_page_version_files f WHERE f.tenant_id=NEW.tenant_id AND f.version_id=NEW.id AND f.role='PRIMARY')<>1 THEN
          RAISE EXCEPTION 'Published file page requires exactly one primary file' USING ERRCODE='23514';
        END IF; RETURN NULL;
      END $$;
      CREATE CONSTRAINT TRIGGER knowledge21_primary_snapshot AFTER INSERT ON knowledge_page_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION knowledge21_primary_snapshot_check();
      CREATE FUNCTION knowledge21_asset_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (NEW.original_name,NEW.storage_key,NEW.content_type,NEW.size,NEW.sha256,NEW.page_id,NEW.tenant_id) IS DISTINCT FROM
          (OLD.original_name,OLD.storage_key,OLD.content_type,OLD.size,OLD.sha256,OLD.page_id,OLD.tenant_id) THEN
          RAISE EXCEPTION 'Knowledge original file assets are immutable' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge21_file_assets_immutable BEFORE UPDATE ON knowledge_file_assets FOR EACH ROW EXECUTE FUNCTION knowledge21_asset_immutable();
      CREATE OR REPLACE VIEW knowledge_page_read_model WITH (security_invoker=true) AS
      SELECT p.id,p.tenant_id,p.space_id,p.parent_id,v.title,p.slug,p.status,p.sort_order,p.version,p.published_version_id,
        p.published_search_text AS search_text,p.created_by,p.created_at,p.updated_by,p.updated_at,v.content,v.content_text,v.tags,
        v.version_no AS published_version,v.published_by,v.published_at,
        (SELECT COALESCE(jsonb_agg(link.file_id),'[]'::jsonb) FROM knowledge_page_version_files link WHERE link.tenant_id=p.tenant_id AND link.version_id=v.id) attachment_ids,
        v.content_mode,v.description
      FROM knowledge_pages p JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id WHERE p.status='PUBLISHED';`);
  }
  async down() {
    throw new Error(
      "Knowledge 2.1 contains immutable file versions; restore a verified backup rather than discard file knowledge.",
    );
  }
}
