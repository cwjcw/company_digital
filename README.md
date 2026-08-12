# 凯南计划中心 Web 应用

本项目把 `4部追踪表_web.xlsx` 转换为 PostgreSQL 驱动的生产主计划和月度计划协同系统。

## Ubuntu 生产部署（Docker Compose）

生产环境使用三个容器：Nginx 静态前端、NestJS API 和 PostgreSQL 18。PostgreSQL 仅加入 Compose 内部网络，不发布宿主机端口。Nginx 是唯一入口，负责 `/api`、`/uploads`、`/socket.io`（含 WebSocket Upgrade）和 React SPA 路由。

当前服务器部署约定：

- 项目目录：`/data/automation/code/work/PMC/knweb`
- 本机入口：`http://127.0.0.1:15172`
- 局域网入口：`http://192.168.1.249:15172`
- 后端容器端口：`15173`（不直接发布）
- 数据库：`four_department_tracker`
- PostgreSQL 数据：`data/postgres`
- 上传文件：`data/uploads`
- 自动备份：`data/backups`
- 恢复日志：`data/logs`

Nginx 只绑定 IPv4/IPv6 回环地址和实际局域网网卡地址，不使用 `0.0.0.0`，因此不会监听服务器的其他网络接口。若服务器局域网地址变化，需要同步修改 `.env` 的 `WEB_LAN_ADDRESS` 和 `WEB_ORIGIN`。
上传目录由启动/恢复脚本设置为共享组可写的 `2775`，使非 root 的 API 容器用户可以写入文件，并保持新建文件的组归属。

### 首次部署

要求 Ubuntu 已安装并启用 Docker Engine 与 Docker Compose 插件。进入项目目录后执行：

```bash
cd /data/automation/code/work/PMC/knweb
./scripts/init-env.sh
docker compose config --quiet
docker compose build
```

`init-env.sh` 只在 `.env` 不存在时创建它，并生成随机数据库密码及两个长度大于 32 位、互不相同的 JWT 密钥；`.env` 权限设置为 `600`。不要把 `.env` 或脚本输出的密钥提交到 Git。

如果需要恢复历史数据库，必须在 migration 或 seed 之前恢复到空数据库：

```bash
./scripts/restore.sh /绝对路径/four_department_tracker.backup 期望的SHA256
./scripts/migrate.sh
./scripts/start.sh
./scripts/healthcheck.sh
```

恢复脚本会先校验 SHA256（如提供）、确认归档可读、启动 PostgreSQL、检查目标 `public` schema 为空，再以 `--exit-on-error --no-owner --no-privileges` 恢复。目标库非空时脚本拒绝覆盖；恢复失败时不会清空目标数据，并将错误保存在 `data/logs`。

`migrate.sh` 会先备份恢复后的数据库，然后显示并运行 TypeORM 中尚未执行的 migration。生产部署流程不自动执行 seed，避免改动现有账户。当前 seed 对已有 admin 不修改密码，但生产迁移仍应显式决定是否运行；通常恢复历史数据库后无需 seed。

### 日常管理

```bash
./scripts/start.sh                 # 启动/恢复全部服务
./scripts/stop.sh                  # 停止并移除容器，不删除持久化数据
./scripts/logs.sh                  # 跟踪全部日志
./scripts/logs.sh api              # 只跟踪后端日志
./scripts/healthcheck.sh           # 检查数据库、网页、API 和 Swagger
./scripts/backup.sh                # 备份数据库及上传目录
./scripts/upgrade.sh               # 先备份，再构建、迁移、重启和健康检查
docker compose ps                  # 查看容器状态
docker compose restart             # 验证/执行服务重启
```

不要使用 `docker compose down -v`。本项目使用宿主机绑定目录持久化，正常的 `down`、容器删除或镜像重建不会删除 `data/postgres` 和 `data/uploads`。

### Cloudflare Tunnel

Tunnel 继续由宿主机 systemd 服务管理，不加入本项目 Compose。局域网验证通过后，在 Cloudflare Zero Trust 中将 `knplan.cuixiaoyuan.cn` 的服务 URL 设置为 `http://localhost:15172`。`.env` 的 `WEB_ORIGIN` 必须同时包含实际本机、局域网和 HTTPS 域名来源，修改后重启 API：

```bash
docker compose up -d --force-recreate api web
```

### 备份与恢复

`./scripts/backup.sh` 生成 PostgreSQL custom-format 备份及上传目录压缩包，并打印 SHA256。数据库恢复是有意设计成“只恢复空库”；需要灾难恢复时，应先保留当前 `data/postgres` 和备份，再使用新的空数据目录/数据库执行恢复。绝不对未知或非空目标直接使用 `--clean`。

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
- API：<http://localhost:15173/api/v1>
- Swagger：<http://localhost:15173/api/docs>
- OpenAPI JSON：<http://localhost:15173/api/openapi.json>

开发环境后端使用 15173 端口，Vite 前端使用 5173 端口。生产环境使用上面的 Nginx 入口，不使用 Vite 开发服务器。

## Excel 导入

- 销售接单汇总：进入“主计划 → 销售接单明细”，点击“导入销售接单明细 Excel”。模板为 [`docs/销售订单汇总导入模板.xlsx`](docs/销售订单汇总导入模板.xlsx)。
- 月度计划：进入“主计划 → 月度计划”，先选择目标年份和月份，再点击“导入月度计划 Excel”。模板为 [`docs/月度计划导入模板.xlsx`](docs/月度计划导入模板.xlsx)。
- “系统管理 → Excel 导入”旧页面已经删除，避免将不同业务文件导入错误入口。

两个模板的前 5000 个数据行均配置了日期、数字、必填项和字典下拉约束。后端仍会重新校验整份文件；只要有一行错误，界面会显示具体行号和原因，并且整次导入不会写入任何数据。全部正确时才允许预览或事务写入。

上传文件必须是标准、未加密的 `.xlsx`。企业 DRM/透明加密文件即使扩展名为 `.xlsx`，也可能不是 ZIP/XLSX 结构；请先在受信任的 Windows Excel 环境中解密或“另存为”标准 XLSX，再上传。系统不会尝试绕过企业加密。

同一业务键重复导入会更新现有记录，不会增加重复数据。月度计划确认写入前会先显示预览统计，生产部署和导入过程均不会自动执行 seed，也不会重置 admin 密码。

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
