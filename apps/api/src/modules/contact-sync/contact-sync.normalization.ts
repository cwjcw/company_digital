const organizationDisplayNameOverrides = new Map([
  ["厦门凯南展示制品有限公司", "凯南"],
  ["凯南展示制品有限公司", "凯南"]
]);

export function normalizeOrganizationDisplayName(value: unknown) {
  const name = String(value ?? "").trim();
  return organizationDisplayNameOverrides.get(name) ?? name;
}

export function normalizeOrganizationPath(path: unknown[]) {
  return path.map(normalizeOrganizationDisplayName).filter(Boolean);
}
