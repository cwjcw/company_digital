/** Compare publishable working data with the immutable current snapshot.
 * Technical versions, ordering, ACL and asynchronous previews are not content changes.
 * Both record and published aliases must belong to the authorized page detail query.
 */
export const knowledgeUnpublishedChanges = `(
  published.id IS NULL
  OR record.title IS DISTINCT FROM published.title
  OR record.working_content IS DISTINCT FROM published.content
  OR record.description IS DISTINCT FROM published.description
  OR record.content_mode IS DISTINCT FROM published.content_mode
  OR COALESCE((
    SELECT jsonb_agg(tag.name ORDER BY tag.name)
    FROM knowledge_page_tags link
    JOIN knowledge_tags tag ON tag.tenant_id=link.tenant_id AND tag.id=link.tag_id
    WHERE link.tenant_id=record.tenant_id AND link.page_id=record.id
  ), '[]'::jsonb) IS DISTINCT FROM published.tags
  OR EXISTS (
    (SELECT file_id,role FROM knowledge_page_files
     WHERE tenant_id=record.tenant_id AND page_id=record.id
     EXCEPT
     SELECT file_id,role FROM knowledge_page_version_files
     WHERE tenant_id=record.tenant_id AND page_id=record.id AND version_id=published.id)
    UNION ALL
    (SELECT file_id,role FROM knowledge_page_version_files
     WHERE tenant_id=record.tenant_id AND page_id=record.id AND version_id=published.id
     EXCEPT
     SELECT file_id,role FROM knowledge_page_files
     WHERE tenant_id=record.tenant_id AND page_id=record.id)
  )
)`;
