import { MigrationInterface, QueryRunner } from "typeorm";

/** Knowledge lives in the active compatibility database, like supervision/rd. */
export class KnowledgeBasePhaseOne1722920084000 implements MigrationInterface {
  name = "KnowledgeBasePhaseOne1722920084000";
  async up(runner: QueryRunner) {
    await runner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    const audit = `created_by uuid REFERENCES users(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0)`;
    await runner.query(`CREATE TABLE knowledge_categories (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, parent_id uuid, level smallint NOT NULL,
      code varchar(64) NOT NULL, name varchar(100) NOT NULL CHECK(btrim(name)<>''), description text,
      sort_order integer NOT NULL DEFAULT 0, enabled boolean NOT NULL DEFAULT true, ${audit},
      UNIQUE(tenant_id,id), UNIQUE(tenant_id,code), UNIQUE NULLS NOT DISTINCT(tenant_id,parent_id,name),
      CHECK((level=1 AND parent_id IS NULL) OR (level=2 AND parent_id IS NOT NULL)),
      FOREIGN KEY(tenant_id,parent_id) REFERENCES knowledge_categories(tenant_id,id) ON DELETE RESTRICT);
      CREATE INDEX idx_knowledge_categories_tree ON knowledge_categories(tenant_id,parent_id,sort_order);`);
    await runner.query(`CREATE TABLE knowledge_articles (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, category_id uuid NOT NULL,
      title varchar(300) NOT NULL CHECK(btrim(title)<>''), summary text NOT NULL DEFAULT '',
      content jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}', content_text text NOT NULL DEFAULT '',
      content_hash varchar(64) NOT NULL, search_text text NOT NULL DEFAULT '',
      visibility jsonb NOT NULL DEFAULT '{"type":"ALL","subjectIds":[]}', attachment_ids jsonb NOT NULL DEFAULT '[]',
      status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','DISABLED')),
      working_revision integer NOT NULL DEFAULT 1 CHECK(working_revision>0), published_version integer,
      published_by uuid REFERENCES users(id) ON DELETE RESTRICT, published_at timestamptz, view_count bigint NOT NULL DEFAULT 0 CHECK(view_count>=0),
      deleted_at timestamptz, ${audit}, UNIQUE(tenant_id,id),
      FOREIGN KEY(tenant_id,category_id) REFERENCES knowledge_categories(tenant_id,id) ON DELETE RESTRICT,
      CHECK(jsonb_typeof(attachment_ids)='array'), CHECK(jsonb_typeof(content)='object'),
      CHECK(visibility->>'type' IN ('ALL','ORGANIZATION','ROLE','USER') AND jsonb_typeof(visibility->'subjectIds')='array'),
      CHECK(published_version IS NULL OR published_version>0), CHECK(status<>'PUBLISHED' OR published_version IS NOT NULL));
      CREATE INDEX idx_knowledge_articles_list ON knowledge_articles(tenant_id,status,updated_at DESC,id);
      CREATE INDEX idx_knowledge_articles_category ON knowledge_articles(tenant_id,category_id);
      CREATE INDEX idx_knowledge_articles_search ON knowledge_articles USING gin(search_text gin_trgm_ops);`);
    await runner.query(`CREATE TABLE knowledge_tags (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, name varchar(100) NOT NULL CHECK(btrim(name)<>''),
      ${audit}, UNIQUE(tenant_id,id), UNIQUE(tenant_id,name));
      CREATE TABLE knowledge_article_tags (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, article_id uuid NOT NULL, tag_id uuid NOT NULL, ${audit},
      UNIQUE(tenant_id,article_id,tag_id),
      FOREIGN KEY(tenant_id,article_id) REFERENCES knowledge_articles(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,tag_id) REFERENCES knowledge_tags(tenant_id,id) ON DELETE RESTRICT);
      CREATE INDEX idx_knowledge_article_tags_tag ON knowledge_article_tags(tenant_id,tag_id);`);
    await runner.query(`CREATE TABLE knowledge_attachments (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, article_id uuid NOT NULL,
      original_name varchar(255) NOT NULL, storage_key varchar(500) NOT NULL UNIQUE, content_type varchar(150) NOT NULL,
      size integer NOT NULL CHECK(size>0 AND size<=20971520), sha256 varchar(64) NOT NULL, detached_at timestamptz,
      ${audit}, UNIQUE(tenant_id,article_id,id),
      FOREIGN KEY(tenant_id,article_id) REFERENCES knowledge_articles(tenant_id,id) ON DELETE RESTRICT);
      CREATE INDEX idx_knowledge_attachments_article ON knowledge_attachments(tenant_id,article_id);`);
    await runner.query(`CREATE TABLE knowledge_article_versions (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, article_id uuid NOT NULL,
      version_no integer NOT NULL CHECK(version_no>0), working_revision integer NOT NULL,
      category_id uuid NOT NULL, category_name varchar(100) NOT NULL, root_category_name varchar(100) NOT NULL,
      title varchar(300) NOT NULL, summary text NOT NULL, content jsonb NOT NULL, content_text text NOT NULL,
      content_hash varchar(64) NOT NULL, search_text text NOT NULL, tags jsonb NOT NULL,
      visibility jsonb NOT NULL, published_by uuid REFERENCES users(id) ON DELETE RESTRICT, published_at timestamptz NOT NULL DEFAULT now(), ${audit},
      UNIQUE(tenant_id,article_id,version_no), UNIQUE(tenant_id,article_id,id),
      FOREIGN KEY(tenant_id,article_id) REFERENCES knowledge_articles(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,category_id) REFERENCES knowledge_categories(tenant_id,id) ON DELETE RESTRICT);
      CREATE INDEX idx_knowledge_versions_search ON knowledge_article_versions USING gin(search_text gin_trgm_ops);
      ALTER TABLE knowledge_articles ADD CONSTRAINT fk_knowledge_published_version FOREIGN KEY(tenant_id,id,published_version)
        REFERENCES knowledge_article_versions(tenant_id,article_id,version_no) DEFERRABLE INITIALLY DEFERRED;
      CREATE TABLE knowledge_version_attachments (
        id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL, article_id uuid NOT NULL, version_id uuid NOT NULL, attachment_id uuid NOT NULL, ${audit},
        UNIQUE(tenant_id,version_id,attachment_id),
        FOREIGN KEY(tenant_id,article_id,version_id) REFERENCES knowledge_article_versions(tenant_id,article_id,id) ON DELETE RESTRICT,
        FOREIGN KEY(tenant_id,article_id,attachment_id) REFERENCES knowledge_attachments(tenant_id,article_id,id) ON DELETE RESTRICT);`);
    await runner.query(`CREATE FUNCTION knowledge_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Knowledge published snapshots are immutable' USING ERRCODE='23514'; END $$;
      CREATE TRIGGER knowledge_versions_immutable BEFORE UPDATE OR DELETE ON knowledge_article_versions FOR EACH ROW EXECUTE FUNCTION knowledge_immutable_snapshot();
      CREATE TRIGGER knowledge_version_attachments_immutable BEFORE UPDATE OR DELETE ON knowledge_version_attachments FOR EACH ROW EXECUTE FUNCTION knowledge_immutable_snapshot();
      CREATE FUNCTION knowledge_category_depth() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM knowledge_categories WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_id AND level=1) THEN
          RAISE EXCEPTION 'Knowledge categories support only two levels' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge_categories_depth BEFORE INSERT OR UPDATE OF parent_id,level ON knowledge_categories FOR EACH ROW EXECUTE FUNCTION knowledge_category_depth();`);
    for (const table of ["knowledge_categories", "knowledge_articles", "knowledge_tags", "knowledge_article_tags", "knowledge_attachments", "knowledge_article_versions", "knowledge_version_attachments"]) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_tenant_policy ON ${table} USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true))`);
    }
    const tenant = process.env.KDOS_DEFAULT_TENANT_CODE ?? "KAINAN";
    await runner.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenant]);
    await runner.query(`INSERT INTO knowledge_categories(tenant_id,level,code,name,sort_order) VALUES($1,1,'HR','人力资源',0) ON CONFLICT(tenant_id,code) DO NOTHING`, [tenant]);
  }
  async down(runner: QueryRunner) {
    await runner.query(`ALTER TABLE knowledge_articles DROP CONSTRAINT fk_knowledge_published_version;
      DROP TABLE knowledge_version_attachments,knowledge_article_versions,knowledge_attachments,knowledge_article_tags,knowledge_tags,knowledge_articles,knowledge_categories;
      DROP FUNCTION knowledge_immutable_snapshot(); DROP FUNCTION knowledge_category_depth();`);
    // pg_trgm may be shared by other modules; never drop it here.
  }
}
