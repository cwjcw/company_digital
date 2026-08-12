# 凯南计划中心 Web 应用

本项目把 `4部追踪表_web.xlsx` 转换为 PostgreSQL 驱动的生产主计划和月度计划协同系统。

## 首次配置

要求：Windows PowerShell、Node.js 22、pnpm 11、PostgreSQL 18。

1. 在项目根目录打开 PowerShell。
2. 运行：

   ```powershell
   .\scripts\setup.ps1
   ```

3. 首次运行会由 `.env.example` 创建 `.env`。编辑 `.env`，填写 PostgreSQL 参数、两个长度至少 32 位且彼此不同的 JWT 密钥；如需固定首次管理员密码，填写 `ADMIN_INITIAL_PASSWORD`。
4. 再次运行 `.\scripts\setup.ps1`。脚本将安装依赖、创建数据库、执行 migration 和幂等 seed。没有指定管理员密码时，终端只显示一次随机密码。

真实密码、JWT 密钥和 API Key 不得写入 Git。

## 手工启动

启动前请确认 PostgreSQL 已运行；需要公网访问时，还要确认 Cloudflare Tunnel 服务已运行。

在 PowerShell 中进入项目目录，然后同时启动前端和后端：

```powershell
Set-Location "E:\KaiNice\工作\凯南\02_PMC\主计划表\追踪表\web"
pnpm dev
```

保持 PowerShell 窗口开启。停止项目时，在该窗口按 `Ctrl+C`。

如果同时启动失败，可以打开两个 PowerShell 窗口分别启动。

窗口一启动后端：

```powershell
Set-Location "E:\KaiNice\工作\凯南\02_PMC\主计划表\追踪表\web"
pnpm --filter @tracker/api dev
```

窗口二启动前端：

```powershell
Set-Location "E:\KaiNice\工作\凯南\02_PMC\主计划表\追踪表\web"
pnpm --filter @tracker/web dev
```

也可以使用项目脚本同时启动：

```powershell
.\scripts\dev.ps1
```

启动后的访问地址：

- 本机网页：<http://localhost:5173>
- 局域网网页：<http://192.168.124.100:5173>
- 公网网页：<https://knplan.cuixiaoyuan.cn>
- API：<http://localhost:18080/api/v1>
- Swagger：<http://localhost:18080/api/docs>
- OpenAPI JSON：<http://localhost:18080/api/openapi.json>

后端使用 18080 端口，前端使用 5173 端口。Cloudflare Tunnel 的服务类型为 `HTTP`，服务 URL 为 `http://localhost:5173`。如果 `cloudflared` 已安装为 Windows 服务，通常会随 Windows 自动启动。

## 首次导入

1. 用管理员登录，进入“系统管理 → Excel 导入”。
2. 明确选择年份和月份，例如 2026 年 8 月。
3. 选择 Excel 文件。系统先检查是否为标准 XLSX；对于本机可打开的加密文件，会通过 Windows Excel 临时转换成标准 XLSX，再由后端 ExcelJS 校验和导入。文件密码可在界面中临时填写，不会保存到数据库、日志或导入任务中。若加密提供方禁止后台自动化，则在 Excel 中“另存为”标准 `.xlsx` 后再导入。

如企业加密软件提供官方解密 CLI，可在 `.env` 设置 `EXCEL_DECRYPT_COMMAND` 与 `EXCEL_DECRYPT_ARGUMENTS`。参数中的 `{input}`、`{output}` 会在运行时替换为临时文件路径；此方式优先于 Excel COM，适合被企业 DRM 拦截的无人值守导入。
4. 查看新增、更新、跳过、警告和失败统计；确认无误后点击“确认写入”。
5. 进入“月度计划”核对明细数据，再到“销售接单汇总”核对订单汇总。

同一文件重复导入使用业务键更新，不会增加重复品号。

## 测试

```powershell
.\scripts\test.ps1
```

也可分别运行：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## 备份

使用 PostgreSQL 自带的 `pg_dump.exe`，密码通过交互或 `PGPASSFILE` 提供：

```powershell
& "D:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h 127.0.0.1 -U postgres -Fc -f ".\data\four_department_tracker.backup" four_department_tracker
```

恢复前先新建空数据库，再用 `pg_restore.exe`。上传图片目录默认为 `data/uploads`，如投入使用也要一并备份。
