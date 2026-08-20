# KDOS 重构前测试基线

执行时间：2026-08-20（Asia/Shanghai）

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm lint` | PASS | shared TypeScript、API ESLint、Web ESLint 全部通过 |
| `pnpm typecheck` | PASS | shared、API、Web 全部通过 |
| `pnpm test` | PASS | shared 3、API 12、Web 5，共 20 个测试通过 |
| `pnpm build` | PASS | API 和 Web 构建通过；Web 主包 2,556.16 kB、gzip 767.35 kB，存在大包告警 |
| `pnpm test:e2e` | PASS | Playwright 11/11 通过；mock 场景运行时 Vite 对本机 15173 的代理有连接告警，不影响测试断言 |
| `pnpm test:tplus-sync` | PASS | Node test 2/2 通过 |
| 基线截图专项 Playwright | PASS | 月度计划专项测试 1/1 通过并生成两张截图 |

## 基线结论

重构起点在 lint、类型、单元测试、构建和 UI 回归层面均为绿色。后续任何失败默认视为重构回归，除非有明确证据表明环境发生变化。

当前已知但不阻塞的基线问题：

- Web 生产 bundle 过大，适合在 App 拆分时通过路由懒加载和手工 chunk 改善。
- E2E 使用 API mock；需要在 KDOS 新数据库就绪后补充真实 API/数据库集成测试。
- 旧 API 容器仅在 Compose 内部暴露 15173，Vite 测试代理尝试访问宿主机 15173 时会记录连接告警。
