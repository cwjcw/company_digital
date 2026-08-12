DELETE FROM role_organization_scopes;
DELETE FROM organization_units;
DO $$
DECLARE
  contact_row record;
  path_value jsonb;
  department_name text;
  division_name text;
  parent_node uuid;
  current_node uuid;
  level_no integer;
BEGIN
  FOR contact_row IN SELECT department_paths FROM contacts WHERE enabled=true LOOP
    FOR path_value IN SELECT value FROM jsonb_array_elements(contact_row.department_paths) LOOP
      parent_node := NULL;
      level_no := 0;
      division_name := CASE WHEN jsonb_array_length(path_value) > 1 THEN path_value->>1 ELSE NULL END;
      FOR department_name IN SELECT value FROM jsonb_array_elements_text(path_value) LOOP
        level_no := level_no + 1;
        SELECT ou.id INTO current_node FROM organization_units ou
          WHERE ou.parent_id IS NOT DISTINCT FROM parent_node AND ou.name = department_name LIMIT 1;
        IF current_node IS NULL THEN
          INSERT INTO organization_units(name, level, parent_id, division, enabled, sort_order)
          VALUES (department_name, level_no, parent_node, division_name, true, 0) RETURNING id INTO current_node;
        ELSE
          UPDATE organization_units SET division=COALESCE(organization_units.division, division_name) WHERE id=current_node;
        END IF;
        parent_node := current_node;
        current_node := NULL;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
