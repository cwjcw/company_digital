/** The intentionally small first-version vocabulary for schema-driven UI. */
export type KdosFieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "user"
  | "organization";

export interface KdosOptionSchema {
  value: string | number | boolean;
  label: string;
  disabled?: boolean;
}

export interface KdosFieldSchema {
  key: string;
  label: string;
  type: KdosFieldType;
  required?: boolean;
  readOnly?: boolean;
  options?: readonly KdosOptionSchema[];
  multiple?: boolean;
}

export interface KdosFormSchema {
  fields: readonly KdosFieldSchema[];
}

export interface KdosDetailSchema {
  fields: readonly KdosFieldSchema[];
}

export interface KdosTableColumnSchema {
  field: string;
  label?: string;
  sortable?: boolean;
  filterable?: boolean;
}

export interface KdosTableSchema {
  columns: readonly KdosTableColumnSchema[];
}

export interface KdosResourceSchema {
  code: string;
  label: string;
  fields: readonly KdosFieldSchema[];
  form?: KdosFormSchema;
  detail?: KdosDetailSchema;
  table?: KdosTableSchema;
}

export interface KdosSchemaValidationResult {
  valid: boolean;
  errors: readonly string[];
}

const fieldTypes = new Set<KdosFieldType>([
  "text",
  "textarea",
  "number",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "user",
  "organization",
]);

/**
 * Validates the structural contract only. Authorization, data rules and
 * persistence validation remain owned by the relevant application module.
 */
export function validateKdosResourceSchema(schema: KdosResourceSchema): KdosSchemaValidationResult {
  const errors: string[] = [];
  if (!schema.code.trim()) errors.push("resource.code is required");
  if (!schema.label.trim()) errors.push("resource.label is required");

  const fieldKeys = new Set<string>();
  for (const field of schema.fields) {
    if (!field.key.trim()) errors.push("field.key is required");
    if (fieldKeys.has(field.key)) errors.push(`duplicate field key: ${field.key}`);
    fieldKeys.add(field.key);
    if (!field.label.trim()) errors.push(`field.label is required: ${field.key}`);
    if (!fieldTypes.has(field.type)) errors.push(`unsupported field type: ${field.key}`);
    if (["select", "multiSelect"].includes(field.type) && !field.options?.length) {
      errors.push(`options are required for choice field: ${field.key}`);
    }
    if (field.options) {
      const optionValues = new Set<string>();
      for (const option of field.options) {
        const value = String(option.value);
        if (optionValues.has(value)) errors.push(`duplicate option value: ${field.key}.${value}`);
        optionValues.add(value);
        if (!option.label.trim()) errors.push(`option.label is required: ${field.key}.${value}`);
      }
    }
  }

  const validateViewFields = (keys: readonly string[], viewName: string) => {
    for (const key of keys) {
      if (!fieldKeys.has(key)) errors.push(`${viewName} references unknown field: ${key}`);
    }
  };
  validateViewFields(schema.form?.fields.map((field) => field.key) ?? [], "form");
  validateViewFields(schema.detail?.fields.map((field) => field.key) ?? [], "detail");
  validateViewFields(schema.table?.columns.map((column) => column.field) ?? [], "table");

  return { valid: errors.length === 0, errors };
}

export function assertValidKdosResourceSchema(schema: KdosResourceSchema): void {
  const result = validateKdosResourceSchema(schema);
  if (!result.valid) throw new Error(`Invalid KDOS resource schema: ${result.errors.join("; ")}`);
}
