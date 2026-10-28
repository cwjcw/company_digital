import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities';
import { LOGISTICS_REPOSITORY, type LogisticsRepository } from './logistics.repository';
@Injectable()
export class LogisticsDirectoryQueryService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, @Inject(LOGISTICS_REPOSITORY) private readonly repository: LogisticsRepository) {}
  async members(tenant: string, includeDisabled = false) {
    const users = await this.users.find({ where: { tenantId: tenant, ...(includeDisabled ? {} : { enabled: true }) }, order: { displayName: 'ASC' }, select: ['id', 'username', 'displayName', 'enabled', 'employeeNo'] });
    return users.map(u => ({ id: u.id, username: u.username, displayName: u.displayName, enabled: u.enabled, employeeNo: u.employeeNo }));
  }
  async customers(tenant: string) {
    // Existing Marketing customer data is keyed by tenant + customer_code, not by a guessed name.
    return this.repository.query(`SELECT customer_code AS code FROM marketing.business_customer_mappings WHERE tenant_id=(SELECT id FROM iam.tenants WHERE code=$1 AND enabled=true) ORDER BY customer_code`, [tenant]);
  }
  async references(tenant: string) { const [customers, members] = await Promise.all([this.customers(tenant), this.members(tenant)]); return { customers, members }; }
}
