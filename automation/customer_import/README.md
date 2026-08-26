# 客户数据导入

该目录是 T+ / E10 客户数据导入的唯一入口。读取来源库与写入 KDOS 分离：Python 只读外部 SQL Server，写入必须调用 KDOS 后端应用命令，不能直接修改 PostgreSQL。

## 环境初始化

```bash
python3 -m venv automation/customer_import/.venv
automation/customer_import/.venv/bin/pip install -r automation/customer_import/requirements.txt
automation/customer_import/.venv/bin/pip install -e /data/automation/code/work/basci/basic_code
```

T+ 连接只读取本项目 `.env` 中既有的 `TPLUS_SQL_*`；E10 连接使用 `basic_code` 自己的 `.env`。这里不保存或复制任何数据库密码。

## 统一入口

```bash
# 指定客户、两个 T+ 账套
automation/customer_import/.venv/bin/python automation/customer_import/main.py --source tplus --customer A027

# 指定 T+ 账套
automation/customer_import/.venv/bin/python automation/customer_import/main.py --source tplus --database UFTData418971_000003 --customer A027

# 逐客户导入全部客户（每个客户独立快照，避免超大事务）
automation/customer_import/.venv/bin/python automation/customer_import/main.py --source tplus --all

# E10 指定客户
automation/customer_import/.venv/bin/python automation/customer_import/main.py --source e10 --customer A027

# 只做来源统计，不写系统
automation/customer_import/.venv/bin/python automation/customer_import/main.py --source tplus --customer A027 --dry-run
```

首次用真实数据替换演示数据时显式加 `--clear-demo-data`。命令完成后会在 `outputs/` 生成 Excel 清单；源业务明细不会落盘。
