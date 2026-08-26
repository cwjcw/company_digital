import "reflect-metadata";
import path from "node:path";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { ModificationAuditSubscriber } from "./modification-audit";

config({ path: path.resolve(process.cwd(), "../../.env") });

const dataSource = new DataSource({
  type: "postgres",
  host: process.env.DATABASE_HOST ?? "127.0.0.1",
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER ?? "postgres",
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME ?? "four_department_tracker",
  entities,
  migrations: [path.join(__dirname, "migrations/*.{ts,js}")],
  subscribers: [ModificationAuditSubscriber],
  synchronize: false,
  // Import failures can contain complete ERP rows in bound parameters. Never emit
  // database queries/parameters to application logs; opt in to warnings only.
  logging: process.env.TYPEORM_WARNINGS === "true" ? ["warn"] : false
});

export default dataSource;
