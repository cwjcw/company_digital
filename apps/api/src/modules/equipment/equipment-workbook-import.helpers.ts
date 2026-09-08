export const divisionAliases: Record<string, string> = {
  "事业一部": "事业一部", "事业二部": "事业二部", "事业三部": "事业三部", "事业四部": "事业四部", "研发": "研发中心"
};

export const departmentAliases: Record<string, string> = {
  "事业一部|下料中心": "下料课", "事业一部|亚克力车间": "亚克力",
  "事业二部|制造二部": "二部生产部", "事业四部|品管部": "四部品管部",
  "事业四部|烤漆车间": "喷涂课", "事业四部|生产部": "四部生产部",
  "事业四部|五金车间": "加工焊磨课", "事业四部|包装车间": "包装课",
  "研发|研发": "研发中心"
};

export function monitoringValue(value: string) {
  const normalized = value.trim().toLocaleUpperCase();
  if (["需要", "需要填报", "是", "Y", "YES", "TRUE", "1"].includes(normalized)) return true;
  if (["", "无需", "不需要", "无需填报", "否", "N", "NO", "FALSE", "0"].includes(normalized)) return false;
  throw new Error(`是否填报“${value}”不是有效选项`);
}

export function shouldSkipEquipmentImport(value: string) {
  return value.trim() === "不需要";
}
