import { MigrationInterface, QueryRunner } from "typeorm";

/** Add directories without converting or discarding legacy page trees or snapshots. */
export class KnowledgeFolders1722920087000 implements MigrationInterface {
  name = "KnowledgeFolders1722920087000";
  async up(r: QueryRunner) {
    // Prevent concurrent business writes during backfill and verify every original row.
    const tables=["knowledge_spaces","knowledge_space_access","knowledge_pages","knowledge_page_access","knowledge_tags","knowledge_page_tags","knowledge_file_assets","knowledge_page_versions","knowledge_page_version_files","knowledge_storage_cleanup","knowledge_page_files","knowledge_file_previews","knowledge_file_upload_requests"];
    await r.query(`LOCK TABLE ${tables.join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    const fingerprint=async(table:string)=>{
      const omitted=table==="knowledge_pages" ? "-'folder_id'" : table==="knowledge_page_versions" ? "-'space_id'-'parent_id'-'folder_id'" : "";
      return (await r.query(`SELECT count(*)::text total,md5(COALESCE(string_agg(md5((to_jsonb(original)${omitted})::text),'' ORDER BY id),'')) hash FROM ${table} original`))[0];
    };
    const before=await Promise.all(tables.map(fingerprint));
    await r.query(`CREATE TABLE knowledge_folders (
      id uuid PRIMARY KEY DEFAULT uuidv7(), tenant_id varchar(64) NOT NULL,
      space_id uuid NOT NULL, parent_folder_id uuid, name varchar(200) NOT NULL CHECK(btrim(name)<>''),
      sort_order integer NOT NULL DEFAULT 0, status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_by varchar NOT NULL DEFAULT 'system', updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,id), UNIQUE(tenant_id,space_id,id), CHECK(parent_folder_id IS NULL OR parent_folder_id<>id),
      FOREIGN KEY(tenant_id,space_id) REFERENCES knowledge_spaces(tenant_id,id) ON DELETE RESTRICT,
      FOREIGN KEY(tenant_id,space_id,parent_folder_id) REFERENCES knowledge_folders(tenant_id,space_id,id) DEFERRABLE INITIALLY DEFERRED);
      CREATE UNIQUE INDEX knowledge_folder_name_unique ON knowledge_folders(tenant_id,space_id,parent_folder_id,lower(btrim(name))) NULLS NOT DISTINCT WHERE status='ACTIVE';
      CREATE INDEX knowledge_folders_tree ON knowledge_folders(tenant_id,space_id,parent_folder_id,sort_order,id) WHERE status='ACTIVE';
      ALTER TABLE knowledge_folders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY knowledge_folders_tenant ON knowledge_folders USING(tenant_id=current_setting('app.tenant_id',true)) WITH CHECK(tenant_id=current_setting('app.tenant_id',true));
      CREATE FUNCTION knowledge_folders_check_tree() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended('knowledge-tree:'||NEW.tenant_id,0));
        IF NEW.parent_folder_id IS NOT NULL AND EXISTS(
          WITH RECURSIVE parents AS (
            SELECT id,parent_folder_id,ARRAY[id] visited FROM knowledge_folders WHERE tenant_id=NEW.tenant_id AND id=NEW.parent_folder_id
            UNION ALL SELECT f.id,f.parent_folder_id,p.visited||f.id FROM knowledge_folders f JOIN parents p ON f.id=p.parent_folder_id AND f.tenant_id=NEW.tenant_id WHERE NOT f.id=ANY(p.visited))
          SELECT 1 FROM parents WHERE id=NEW.id) THEN
          RAISE EXCEPTION 'Folder directory cycle' USING ERRCODE='23514';
        END IF; RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge_folders_tree_guard BEFORE INSERT OR UPDATE OF parent_folder_id,space_id ON knowledge_folders FOR EACH ROW EXECUTE FUNCTION knowledge_folders_check_tree();
      ALTER TABLE knowledge_pages ADD COLUMN folder_id uuid,
        ADD CONSTRAINT knowledge_page_folder FOREIGN KEY(tenant_id,space_id,folder_id) REFERENCES knowledge_folders(tenant_id,space_id,id) DEFERRABLE INITIALLY DEFERRED;
      CREATE INDEX knowledge_pages_folder ON knowledge_pages(tenant_id,space_id,folder_id,status);
      ALTER TABLE knowledge_page_versions ADD COLUMN space_id uuid, ADD COLUMN parent_id uuid, ADD COLUMN folder_id uuid;
      ALTER TABLE knowledge_page_versions DISABLE TRIGGER knowledge2_versions_immutable;
      UPDATE knowledge_page_versions v SET space_id=COALESCE((SELECT old.id FROM knowledge_spaces old WHERE old.tenant_id=v.tenant_id AND old.id::text=v.breadcrumb->0->>'id'),p.space_id),parent_id=CASE WHEN jsonb_array_length(v.breadcrumb)>2 THEN (SELECT old.id FROM knowledge_pages old WHERE old.tenant_id=v.tenant_id AND old.id::text=v.breadcrumb -> -2 ->> 'id') ELSE NULL END FROM knowledge_pages p WHERE p.tenant_id=v.tenant_id AND p.id=v.page_id;
      ALTER TABLE knowledge_page_versions ENABLE TRIGGER knowledge2_versions_immutable;
      ALTER TABLE knowledge_page_versions ALTER COLUMN space_id SET NOT NULL,
        ADD CONSTRAINT knowledge_version_space FOREIGN KEY(tenant_id,space_id) REFERENCES knowledge_spaces(tenant_id,id) ON DELETE RESTRICT,
        ADD CONSTRAINT knowledge_version_folder FOREIGN KEY(tenant_id,space_id,folder_id) REFERENCES knowledge_folders(tenant_id,space_id,id) ON DELETE RESTRICT;
      CREATE INDEX knowledge_versions_folder ON knowledge_page_versions(tenant_id,space_id,folder_id);
      CREATE FUNCTION knowledge_version_location_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.space_id IS NULL THEN SELECT p.space_id,p.parent_id,p.folder_id INTO NEW.space_id,NEW.parent_id,NEW.folder_id FROM knowledge_pages p WHERE p.tenant_id=NEW.tenant_id AND p.id=NEW.page_id; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER knowledge_version_location_defaults BEFORE INSERT ON knowledge_page_versions FOR EACH ROW EXECUTE FUNCTION knowledge_version_location_defaults();
      CREATE OR REPLACE VIEW knowledge_page_read_model WITH (security_invoker=true) AS
      SELECT p.id,p.tenant_id,v.space_id,v.parent_id,v.title,p.slug,p.status,p.sort_order,p.version,p.published_version_id,
        p.published_search_text AS search_text,p.created_by,p.created_at,p.updated_by,p.updated_at,v.content,v.content_text,v.tags,
        v.version_no AS published_version,v.published_by,v.published_at,
        (SELECT COALESCE(jsonb_agg(link.file_id),'[]'::jsonb) FROM knowledge_page_version_files link WHERE link.tenant_id=p.tenant_id AND link.version_id=v.id) attachment_ids,
        v.content_mode,v.description,v.folder_id
      FROM knowledge_pages p JOIN knowledge_page_versions v ON v.tenant_id=p.tenant_id AND v.id=p.published_version_id WHERE p.status='PUBLISHED';`);
    for(let i=0;i<tables.length;i++)if(JSON.stringify(await fingerprint(tables[i]))!==JSON.stringify(before[i]))throw new Error(`Knowledge original data integrity mismatch: ${tables[i]}`);
  }
  async down() { throw new Error("Folder locations are retained; restore a verified backup instead of dropping knowledge directories."); }
}
