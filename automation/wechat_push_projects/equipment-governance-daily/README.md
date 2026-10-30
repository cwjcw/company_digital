# 设备管理双日报

原 `equipment-governance-daily` 原地升级，复用现有深色 BI 视觉与 Pillow 模板基础。不再读取培训进度；`training_status.txt` 仅保留历史。2026-10-31用户已确认单人测试效果并授权正式部署：**正式9人，不含高婷武、崔玮杰**；测试模式仍只发崔玮杰。默认只生成图片；不修改设备填报、故障原因、大屏统计 SQL 或在线调度。

## 内容与口径

统计范围固定为事业一部、事业二部、事业三部、事业四部、研发中心，五个单位同级展示。事业部正式名称的“凯南”前缀统一为短名称；先由大屏返回的单位选项解析稳定组织 ID，再使用既有 `equipment-dashboard` CUSTOM/IN 数据范围限制五单位。重名/无稳定 ID 报错，不能按名称混并不同组织；无设备的单位仍显示零值，无分母比率显示“—”。

所有业务数据直接来自 **`EquipmentQueryService.dashboard()`**：

- 运行日报：连续7个按日大屏的 `metrics`、昨日 `divisionRows`，展示昨日五项指标、四种互斥状态、计划/实际/故障时长柱图和稼动率折线、五单位运行明细。不排名、不评价；稼动率直接保留大屏值，不能用各单位百分比求平均，也不能用包括无计划设备的总实际时长重新推算。
- 填报日报：昨日大屏的 `operationsMonitoring.yesterday`、`yesterdayDivisionRows`、`sevenDayTrend.total/divisions`，展示昨日整体、近7天整体/每日趋势、五单位填报和昨日最好/最差（同率并列，应填为0不排名）。近7天集团/单位填报率按原始台次加总计算，不平均每日百分比。
- 沿用大屏“active且monitored设备”“active填报”“故障优先于正常、未运行、无记录为未填报”的规则。五单位之外的数据不会混入集团合计。
- `print-equipment-governance-summary.ts` 是现有查询CLI的薄适配，不维护另一套业务SQL。一次 REPEATABLE READ **只读事务**、当前租户上下文，调用同一个 Query Service；不会 bootstrap AppModule、运行迁移、启动定时器或写业务数据。

北京时间 `Asia/Shanghai` 的昨日为统计日，7天为昨日向前6天（含昨日），不包含今天。例如10月30日运行：统计日10月29日，范围10月23日～29日。图片和文字都不显示发送时间。

正文固定不变；最前面按每位收件人增加称呼，例如测试发给崔玮杰时为：

```text
您好,崔玮杰,请收

【设备管理日报表】2026年10月29日

日报1：设备运行日报。

日报2：设备填报情况。过去7天集团填报率为100%时，不发送设备填报报表；未达到100%时，发送设备填报报表。
```

## 发送顺序与保护

以下步骤按接收人逐一执行，文字及图片均只发给当前这一人，不用群发touser承载个性化称呼。

1. 文字成功。
2. 等待 `text_delay_seconds`（默认3秒），发送运行日报成功。
3. 此时才判断：`SUM(7天filledEquipmentCount) == SUM(7天expectedEquipmentCount)`。
4. 相等就结束，不生成/发送填报图；不相等则等待 `reporting_image_delay_seconds`（默认5秒），生成并发送填报图。

绝不使用格式化的 `100.0%` 判断；699/700、6999/7000均未完成，即使显示四舍五入为100.0%也发填报图。0/0按用户要求的原始相等规则结束，显示比率为“—”。默认预览可生成两图，便于本地检查。

任一发送失败非零退出，不继续后续内容，不虚报成功；仅复用 basic_code 的默认自建应用 `WeChatPusher`，无群机器人回退、无新SDK。测试配置必须严格等于 `["崔玮杰"]`，禁止 `@all`、缺失或重名通讯录成员。正式收件人单独保留，2026-10-31已按用户要求移除高婷武、崔玮杰，剩余9人（测试名单仍仅崔玮杰），用户确认后配置`allow_production_send=true`；正式执行仍须`--send-production --confirm-production`，默认命令不发送。

全流程使用输出目录中的 `flock` 非并发锁。按业务日/test或production分别保存受限的逐组件回执；重复运行跳过已成功组件，明确失败仅补未成功组件。网络超时/进程中断导致 `sending` 状态时，不能知道服务端是否收到，**禁止自动重发**：管理员先核对企业微信实际接收情况，再将对应状态改为 `sent` 或 `failed` 恢复，保留原回执副本。不要直接删除当天回执重跑。收件人变化拒绝复用旧回执，避免错误补发。

## 本机运行与验证

使用 `/data/automation/code/work/basci/basic_code/.venv/bin/python`，凭据只在 basic_code 自己的 `.env`，不得复制到项目或n8n命令。需要 Docker Compose 访问当前API容器和已安装Noto CJK字体/Pillow。

首次或更新查询适配后，在根目录构建API（**只构建，不部署**）：

```bash
cd /data/automation/code/work/PMC/knweb
pnpm --filter @tracker/api build
```

Python将本地构建的查询适配器经stdin交给现有API容器执行，用容器里现有Query Service与数据库环境；不复制/替换容器文件、无需部署本轮待发布API。构建缺失或比源文件旧时明确拒绝。若以后大屏查询契约变化，应先兼容验证再更新容器，不能继续使用过期schema。

```bash
cd /data/automation/code/work/PMC/knweb/automation/wechat_push_projects/equipment-governance-daily

# 在线只读取数并生成两图，不发送
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py

# 真实单人测试（同日已发成功的组件不会重复发送）
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py --send-test

# 单元测试，fake pusher，无真实发送
/data/automation/code/work/basci/basic_code/.venv/bin/python -m unittest -v test_report.py
```

同日已经测试成功、用户明确要求验收新版时，使用独立且固定的测试批次标识；例如 `report.py --send-test --test-run-id greeting-hd-20261031`。它保留旧图片/回执，新批次输出在 `YYYY-MM-DD/tests/<标识>/`，重跑相同标识仍跳过已成功组件。该参数只允许单人测试，不能用于正式发送；n8n自动任务继续不带此参数，禁止每次随机生成标识绕过防重。

正式图片/预检在 ignored `data/wechat-push/equipment-governance-daily/YYYY-MM-DD/production/{operation,reporting}.png`，与默认测试/预览的日期目录分开，尺寸2880×3040（原生2倍渲染的无损PNG，表格文字已加大，单图不超过2MB；运行图页脚仅“数据口径：KDOS设备管理大屏”）；回执为对应目录的 `{test,production}-receipt.json`，权限0600。`--output-dir` 可选用于本地调试；正式调度必须固定默认目录，不能通过换目录绕过幂等。`--data-json` 仅预览，不允许与发送参数混用；JSON必须匹配当天统计日期、连续7日和五单位schema，缺数据立即失败，不当作0填补。

## n8n正式发布

唯一任务身份 **EQ-001**，始终复用工作流 `e0dwMjv9OnWmcESk`，不创建第二个设备日报或Timer。仓库 `workflow-template.json` 默认inactive，只有显式发布才启用；SSH Credential为占位符，发布时从原工作流保留，不能写入凭据或导出解密密码。

正式流程：每天12:00（`0 0 12 * * *`），Workflow时区`Asia/Shanghai` → 原SSH凭据调用宿主机 → Code节点检查退出码、JSON、production模式、9人及发送顺序。任何异常走同一工作流的失败分支，用共享WeChatPusher通知维护人崔玮杰，然后Stop And Error，不能把SSH返回code=1当成成功。

- 正式日报接收人：刘义响、朱永远、周志明、张建中、蒋青国、徐玉鹏、廖焕敏、刘丽秋、黄开亮。
- 运维失败告警名单独立：`failure_recipients=["崔玮杰"]`，只告警不接收正式日报，不会把崔玮杰加回9人业务名单。
- SSH命令自身超时540秒；失败告警90秒；工作流总超时720秒。无自动重发未知组件；通过逐人回执人工安全补偿。n8n保留成功/失败执行及进度、耗时、计数。
- 手工节点与定时节点共用同一正式入口；预检通过、用户确认正式启用后才发布，不在部署时提前给9人补发。

```bash
cd /data/automation/code/work/PMC/knweb/automation/wechat_push_projects/equipment-governance-daily && \
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py --send-production --confirm-production
```

### 发布、预检和回滚

1. 只提交/推送本项目改动；保留无关工作区和私有数据。只需构建本地查询适配，不部署整套API或执行主计划待发布迁移。
2. 受限导出原工作流作为回滚前镜像；确认原工作流ID/owner/SSH引用，使用模板占位符替换为原引用，保持owner及其他工作流不变。模板导入时inactive，`isArchived=false`。
3. 同一工作流先做不发送的真实SSH预检：临时命令`report.py --check-production`，Code期望模式改为`production-check`。必须ready=true、sent=false且匹配9个真实联系人，图片成功；检查n8n真实执行记录。预检不使用测试数据，不能伪造正式成功回执。
4. 导入正式模板并显式发布同一ID。当前实例无管理API Key，沿用n8n官方CLI：`import:workflow --input=<受限hydrated文件> --projectId=<原owner project>`、`publish:workflow --id=e0dwMjv9OnWmcESk`。CLI只写配置，需确认无运行中任务后短暂重启原n8n容器，使进程加载新版本；不得停用无关工作流。
5. 核验active/activeVersionId、Asia/Shanghai和12:00表达式、正式命令、原SSH引用、n8n启动激活日志和其他工作流配置/启用集合不变，记录下次计划及健康。发布实证见本地验收报告/进度，不能以模板存在冒充启用。
6. 回滚先使用官方unpublish同一ID，再恢复受限原导出；确认无执行中任务后按同样窗口重启n8n。保留正式/测试回执，绝不为回滚删除它们；旧08:00正式命令保持归档/禁用，不能误恢复群发。不存在数据库Migration或业务数据回退。

默认预览和测试仍可使用；`--notify-failure`是本工作流错误分支的固定维护人告警，不查询设备数据。线上工作流启用/最新成功以`outputs/CODEX_PROGRESS.md`及`outputs/EQUIPMENT_DAILY_LOCAL_ACCEPTANCE.md`记录为准。
