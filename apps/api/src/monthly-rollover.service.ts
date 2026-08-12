import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";

@Injectable()
export class MonthlyRolloverService {
  constructor(private readonly dataSource: DataSource) {}

  @Cron("0 0 1 1 * *", { timeZone: "Asia/Shanghai" })
  async createCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    await this.dataSource.query("SELECT create_monthly_plan($1, $2)", [year, month]);
  }
}

