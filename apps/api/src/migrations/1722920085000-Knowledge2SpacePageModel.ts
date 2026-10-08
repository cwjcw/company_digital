import { MigrationInterface, QueryRunner } from "typeorm";

/** Replace only the unaccepted Knowledge model; historical migrations stay intact. */
export class Knowledge2SpacePageModel1722920085000 implements MigrationInterface {
  name = "Knowledge2SpacePageModel1722920085000";
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE knowledge_articles DROP CONSTRAINT fk_knowledge_published_version;
      DROP TABLE knowledge_version_attachments,knowledge_article_versions,knowledge_attachments,knowledge_article_tags,knowledge_tags,knowledge_articles,knowledge_categories;
      DROP FUNCTION knowledge_immutable_snapshot(); DROP FUNCTION knowledge_category_depth();
      DELETE FROM permissions WHERE resource IN ('knowledge-categories','knowledge-articles');`);
    // Retire Knowledge-only permission groups without deleting users/roles or unrelated grants.
    await runner.query(
      `UPDATE roles SET permission_group_enabled=false WHERE permission_group_resource IN ('knowledge-categories','knowledge-articles')`,
    );
    const audit = `created_by uuid REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0)`;
    await runner.query(`CREATE TABLE knowledge_spaces (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, code varchar(64) NOT NULL CHECK(btrim(code)<>''),
      name varchar(100) NOT NULL CHECK(btrim(name)<>''), description text NOT NULL DEFAULT '', icon varchar(50) NOT NULL DEFAULT 'book',
      sort_order integer NOT NULL DEFAULT 0, status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      ${audit}, UNIQUE(tenant_id,id), UNIQUE(tenant_id,code));
      CREATE INDEX idx_knowledge_spaces_list ON knowledge_spaces(tenant_id,status,sort_order,id);
      CREATE TABLE knowledge_space_access (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,space_id uuid NOT NULL,
      subject_type varchar(20) NOT NULL CHECK(subject_type IN ('ALL','USER','ROLE','ORGANIZATION')),subject_id uuid,
      access_level varchar(20) NOT NULL CHECK(access_level IN ('VIEWER','EDITOR','FULL_ACCESS')),
      ${audit}, CHECK((subject_type='ALL')=(subject_id IS NULL)),
      UNIQUE NULLS NOT DISTINCT(tenant_id,space_id,subject_type,subject_id),
      FOREIGN KEY(tenant_id,space_id) REFERENCES knowledge_spaces(tenant_id,id) ON DELETE CASCADE);
      CREATE INDEX idx_knowledge_space_access_lookup ON knowledge_space_access(tenant_id,space_id);`);
    await runner.query(`CREATE TABLE knowledge_pages (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,space_id uuid NOT NULL,parent_id uuid,
      title varchar(300) NOT NULL DEFAULT '未命名页面' CHECK(btrim(title)<>''),slug varchar(150) NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','ARCHIVED','TRASHED')),
      status_before_trash varchar(20),trash_batch_id uuid,sort_order integer NOT NULL DEFAULT 0,access_restricted boolean NOT NULL DEFAULT false,
      working_content jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}',working_content_text text NOT NULL DEFAULT '',working_content_hash varchar(64) NOT NULL,
      published_search_text text NOT NULL DEFAULT '',published_version_id uuid,trashed_at timestamptz, ${audit},
      UNIQUE(tenant_id,id),UNIQUE(tenant_id,space_id,id),UNIQUE(tenant_id,space_id,slug),
      CHECK(parent_id IS NULL OR parent_id<>id),CHECK(jsonb_typeof(working_content)='object'),
      CHECK(status<>'PUBLISHED' OR published_version_id IS NOT NULL),
      FOREIGN KEY(tenant_id,space_id) REFERENCES knowledge_spaces(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,space_id,parent_id) REFERENCES knowledge_pages(tenant_id,space_id,id) DEFERRABLE INITIALLY DEFERRED);
      CREATE INDEX idx_knowledge_pages_tree ON knowledge_pages(tenant_id,space_id,parent_id,sort_order,id);
      CREATE INDEX idx_knowledge_pages_status ON knowledge_pages(tenant_id,status,updated_at DESC,id);
      CREATE TABLE knowledge_page_access (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,
      subject_type varchar(20) NOT NULL CHECK(subject_type IN ('ALL','USER','ROLE','ORGANIZATION')),subject_id uuid,
      access_level varchar(20) NOT NULL CHECK(access_level IN ('VIEWER','EDITOR','FULL_ACCESS')),${audit},
      CHECK((subject_type='ALL')=(subject_id IS NULL)),UNIQUE NULLS NOT DISTINCT(tenant_id,page_id,subject_type,subject_id),
      FOREIGN KEY(tenant_id,page_id) REFERENCES knowledge_pages(tenant_id,id) ON DELETE CASCADE);
      CREATE INDEX idx_knowledge_page_access_lookup ON knowledge_page_access(tenant_id,page_id);
      CREATE TABLE knowledge_tags(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,name varchar(100) NOT NULL CHECK(btrim(name)<>''),${audit},UNIQUE(tenant_id,id),UNIQUE(tenant_id,name));
      CREATE TABLE knowledge_page_tags(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,tag_id uuid NOT NULL,${audit},UNIQUE(tenant_id,page_id,tag_id),
      FOREIGN KEY(tenant_id,page_id) REFERENCES knowledge_pages(tenant_id,id) ON DELETE CASCADE,
      FOREIGN KEY(tenant_id,tag_id) REFERENCES knowledge_tags(tenant_id,id) ON DELETE RESTRICT);
      CREATE INDEX idx_knowledge_page_tags_lookup ON knowledge_page_tags(tenant_id,page_id);`);
    await runner.query(`CREATE TABLE knowledge_attachments (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,original_name varchar(255) NOT NULL,
      storage_key varchar(500) NOT NULL UNIQUE,content_type varchar(150) NOT NULL,size integer NOT NULL CHECK(size>0 AND size<=20971520),
      sha256 varchar(64) NOT NULL,detached_at timestamptz,${audit},UNIQUE(tenant_id,page_id,id),
      FOREIGN KEY(tenant_id,page_id) REFERENCES knowledge_pages(tenant_id,id) ON DELETE CASCADE);
      CREATE INDEX idx_knowledge_attachments_page ON knowledge_attachments(tenant_id,page_id);
      CREATE TABLE knowledge_page_versions (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,version_no integer NOT NULL CHECK(version_no>0),
      title varchar(300) NOT NULL,content jsonb NOT NULL,content_text text NOT NULL,content_hash varchar(64) NOT NULL,
      tags jsonb NOT NULL,breadcrumb jsonb NOT NULL,access_snapshot jsonb NOT NULL,search_text text NOT NULL,
      published_by uuid REFERENCES users(id) ON DELETE RESTRICT,published_at timestamptz NOT NULL DEFAULT now(),${audit},
      UNIQUE(tenant_id,page_id,version_no),UNIQUE(tenant_id,page_id,id),
      FOREIGN KEY(tenant_id,page_id) REFERENCES knowledge_pages(tenant_id,id) ON DELETE CASCADE);
      CREATE INDEX idx_knowledge_pages_search ON knowledge_pages USING gin(published_search_text gin_trgm_ops);
      CREATE INDEX idx_knowledge_versions_page ON knowledge_page_versions(tenant_id,page_id,version_no DESC);
      ALTER TABLE knowledge_pages ADD CONSTRAINT fk_knowledge_page_published FOREIGN KEY(tenant_id,id,published_version_id)
        REFERENCES knowledge_page_versions(tenant_id,page_id,id) DEFERRABLE INITIALLY DEFERRED;
      CREATE TABLE knowledge_page_version_attachments (
      id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,page_id uuid NOT NULL,version_id uuid NOT NULL,attachment_id uuid NOT NULL,${audit},
      UNIQUE(tenant_id,version_id,attachment_id),
      FOREIGN KEY(tenant_id,page_id,version_id) REFERENCES knowledge_page_versions(tenant_id,page_id,id) ON DELETE CASCADE,
      FOREIGN KEY(tenant_id,page_id,attachment_id) REFERENCES knowledge_attachments(tenant_id,page_id,id) ON DELETE RESTRICT);
      CREATE FUNCTION knowledge2_snapshot_file_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM knowledge_page_versions v WHERE v.tenant_id=NEW.tenant_id AND v.page_id=NEW.page_id AND v.id=NEW.version_id
          AND v.xmin::text::bigint=mod(pg_current_xact_id()::text::numeric,4294967296)) THEN
          RAISE EXCEPTION 'Published Knowledge attachment snapshots are immutable' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge2_version_files_insert BEFORE INSERT ON knowledge_page_version_attachments FOR EACH ROW EXECUTE FUNCTION knowledge2_snapshot_file_insert();
      CREATE FUNCTION knowledge2_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' AND current_setting('app.knowledge_purge',true)='authorized' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Published Knowledge versions are immutable' USING ERRCODE='23514';
      END $$;
      CREATE TRIGGER knowledge2_versions_immutable BEFORE UPDATE OR DELETE ON knowledge_page_versions FOR EACH ROW EXECUTE FUNCTION knowledge2_immutable_snapshot();
      CREATE TRIGGER knowledge2_version_files_immutable BEFORE UPDATE OR DELETE ON knowledge_page_version_attachments FOR EACH ROW EXECUTE FUNCTION knowledge2_immutable_snapshot();`);
    // Serialize tree mutations per tenant. The application additionally checks source/destination ACL.
    await runner.query(`CREATE FUNCTION knowledge2_check_tree() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-tree:'||NEW.tenant_id,0));
        IF NEW.parent_id IS NOT NULL AND EXISTS(
          WITH RECURSIVE ancestors AS (
            SELECT id,parent_id,ARRAY[id] visited FROM knowledge_pages WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id
            UNION ALL SELECT p.id,p.parent_id,a.visited||p.id FROM knowledge_pages p JOIN ancestors a ON p.id=a.parent_id
              WHERE p.tenant_id=NEW.tenant_id AND NOT p.id=ANY(a.visited))
          SELECT 1 FROM ancestors WHERE id=NEW.id) THEN
          RAISE EXCEPTION 'Knowledge page tree cannot contain a cycle' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge2_pages_tree BEFORE INSERT OR UPDATE OF parent_id,space_id ON knowledge_pages FOR EACH ROW EXECUTE FUNCTION knowledge2_check_tree();`);
    await runner.query(
      `CREATE TABLE knowledge_storage_cleanup(id uuid PRIMARY KEY DEFAULT uuidv7(),tenant_id varchar(64) NOT NULL,storage_key varchar(500) NOT NULL UNIQUE,attempts integer NOT NULL DEFAULT 0,${audit});`,
    );
    const tables = [
      "knowledge_storage_cleanup",
      "knowledge_spaces",
      "knowledge_space_access",
      "knowledge_pages",
      "knowledge_page_access",
      "knowledge_page_versions",
      "knowledge_attachments",
      "knowledge_page_version_attachments",
      "knowledge_tags",
      "knowledge_page_tags",
    ];
    for (const table of tables)
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_tenant ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
    await runner.query(`CREATE VIEW knowledge_page_read_model WITH (security_invoker=true) AS
      SELECT p.id,p.tenant_id,p.space_id,p.parent_id,v.title,p.slug,p.status,p.sort_order,p.version,p.published_version_id,
        p.published_search_text AS search_text,p.created_by,p.created_at,p.updated_by,p.updated_at,v.content,v.content_text,v.tags,
        v.version_no AS published_version,v.published_by,v.published_at,
        (SELECT COALESCE(jsonb_agg(link.attachment_id),'[]'::jsonb) FROM knowledge_page_version_attachments link WHERE link.tenant_id=p.tenant_id AND link.version_id=v.id) attachment_ids
      FROM knowledge_pages p JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id
      WHERE p.status='PUBLISHED'`);
    const tenant = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
    await runner.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
    await runner.query(
      `INSERT INTO knowledge_spaces(tenant_id,code,name) VALUES($1,'HR','人力资源') ON CONFLICT(tenant_id,code) DO NOTHING`,
      [tenant],
    );
    await runner.query(
      `INSERT INTO knowledge_space_access(tenant_id,space_id,subject_type,access_level)
      SELECT tenant_id,id,'ALL','VIEWER' FROM knowledge_spaces WHERE tenant_id=$1 AND code='HR' ON CONFLICT DO NOTHING`,
      [tenant],
    );
  }
  async down() {
    throw new Error(
      "Knowledge 2.0 model replacement must be restored from the verified pre-upgrade backup; automatic rollback would delete published knowledge.",
    );
  }
}
