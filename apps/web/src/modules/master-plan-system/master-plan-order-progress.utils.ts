import { mpsOrderProgressEndpoint, type MpsDashboardFilters } from "@kdos/contracts";
export function orderProgressUrl(filters:MpsDashboardFilters,suffix="",extra:Record<string,string>={}){
  const params=new URLSearchParams(extra);for(const [k,v]of Object.entries(filters))if(v!=null&&v!==""&&(!Array.isArray(v)||v.length))params.set(k,Array.isArray(v)?JSON.stringify(v):String(v));
  return `${mpsOrderProgressEndpoint}${suffix}?${params}`;
}
