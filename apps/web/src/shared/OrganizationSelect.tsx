import { Select } from "antd";
import type { SelectProps } from "antd";

export type OrganizationSelectOption = {
  id: string;
  name?: string;
  pathLabel?: string;
  enabled?: boolean;
};

type Props = Omit<SelectProps<string>, "options" | "optionFilterProp" | "optionRender" | "labelRender" | "popupMatchSelectWidth" | "classNames"> & {
  organizations: OrganizationSelectOption[];
  extraOptions?: Array<{ value: string; label: string; disabled?: boolean }>;
};

export function OrganizationSelect({ organizations, extraOptions = [], ...props }: Props) {
  const options = [
    ...extraOptions,
    ...organizations.map((organization) => ({
      value: organization.id,
      label: organization.pathLabel || organization.name || organization.id,
      disabled: organization.enabled === false
    }))
  ];
  return <Select<string>
    {...props}
    showSearch
    optionFilterProp="label"
    options={options}
    popupMatchSelectWidth={false}
    classNames={{ popup: { root: "kdos-organization-select-popup" } }}
    optionRender={(option) => <div className="kdos-organization-option" title={String(option.label ?? "")}>{option.label}</div>}
    labelRender={(selection) => {
      const label = String(selection.label ?? selection.value ?? "");
      return <span className="kdos-organization-selected-label" title={label}>{label}</span>;
    }}
  />;
}
