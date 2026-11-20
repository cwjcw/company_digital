import { AbnormalCostQueryService } from './abnormal-cost.query.service';
import type { AbnormalActor } from './abnormal-cost.policy';
describe('abnormal cost reference options authorization',()=>{
  const principal=(permissions:string[]):AbnormalActor=>({tenantId:'SYN',userId:null,permissions});
  const setup=()=>{const query=jest.fn().mockResolvedValue([]),organizations={listEnabled:jest.fn().mockResolvedValue([])},db={transaction:async(work:(m:unknown)=>unknown)=>work({query})};return {query,organizations,service:new AbnormalCostQueryService(db as never,organizations as never)};};
  it('does not return member or incident-policy catalogs to a category-only reader',async()=>{
    const {service,query,organizations}=setup();expect(await service.options(principal(['abnormal-categories:*:read','abnormal-categories:category_name:read']))).toEqual({users:[],categories:[],severities:[],expenseCategories:[],departments:[],systemAdminId:null});
    expect(query).toHaveBeenCalledTimes(1);expect(organizations.listEnabled).not.toHaveBeenCalled();
  });
  it('returns only severity labels, not amount thresholds, when only the computed result is readable',async()=>{
    const {service,query}=setup();await service.options(principal(['abnormal-responsibility-requests:*:read','abnormal-responsibility-requests:severity_level_id:read']));const sql=query.mock.calls.map(c=>String(c[0])).find(s=>s.includes('FROM incident_severity_levels'));expect(sql).toContain('SELECT id,severity_name');expect(sql).not.toContain('amount_min,amount_max');
  });
  it('does not leak hidden secondary categories through major category choices',async()=>{const {service,query}=setup();await service.options(principal(['abnormal-responsibility-requests:*:read','abnormal-responsibility-requests:major_category:read']));const sql=query.mock.calls.map(c=>String(c[0])).find(s=>s.includes('FROM abnormal_expense_categories'));expect(sql).toContain('SELECT DISTINCT major_category FROM');expect(sql).not.toContain('sub_category');});
  it('rejects an unauthorised user before any reference query',async()=>{const {service,query}=setup();await expect(service.options(principal([]))).rejects.toThrow('无异常费用访问权限');expect(query).not.toHaveBeenCalled();});
});
