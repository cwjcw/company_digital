# T+ 供应商清单导入

`extract.py` 通过统一的 `basic_code.MSSQLDatabase` 只读访问两个 T+ 账套，将
`dbo.AA_PartnerEntity` 中 `partnerType IN (226, 228)` 的往来单位转换为供应商规范模型。
不读取或保存银行账号、税号等敏感字段，也不在本目录落地业务数据快照。

导入必须经过 `SupplyChainApplicationService.importTplusSuppliers`，由应用统一执行校验、
租户隔离、幂等控制和审计。已部署环境可执行：

```bash
automation/customer_import/.venv/bin/python automation/tplus_supplier_import/extract.py \
  | docker compose exec -T api node dist/modules/supply-chain/import-tplus-suppliers.js
```

查询使用 SQL Server `READ COMMITTED` 隔离级别，不写入 T+。
