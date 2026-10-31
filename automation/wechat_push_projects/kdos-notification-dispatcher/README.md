# KDOS 通知 Dispatcher

这是 KDOS `notification_outbox` 的主机端适配器。它只调用内部通知 API 和 `/data/automation/code/work/basci/basic_code` 中的 `WeChatPusher()`，不连接数据库、不查询设备责任人，也不实现业务路由。个人自建应用消息仍使用默认 `WeChatPusher()`；显式配置的群机器人路由使用 `send_robot_*()`，Webhook 只由 API 加密保存并在内部领取时提供给 Dispatcher。

## 群机器人路由（代码已部署，等待测试目标）

API 运行环境通过受限的部署 Environment 注入 `KDOS_NOTIFICATION_SECRET_KEY`（建议随机生成至少 32 字节并妥善备份）。API 使用 AES-256-GCM 保存 Webhook；管理接口只显示掩码。密钥未配置时，群机器人新增/读取明文和 Dispatcher 解密均失败关闭。密钥轮换前需先用原密钥重新加密数据库中已有凭据；不得把密钥写入仓库、工作流、日志或消息审计。

配置位置为 KDOS「消息中心」的群机器人和消息路由页。每条路由按事件类型独立关联一个或多个已启用机器人。Dispatcher 对每个群、每个组件分别记录 delivery；重试时跳过已成功的群/组件，只再发送失败项。支持文本、Markdown 和 PNG 图片；图片由共享 `WeChatPusher` 负责编码和发送。测试发送只针对管理员明确选择的单个群。

设备日报事件为 `equipment.daily_report`，由脚本显式使用 `--submit-notification-event` 提交文字及 PNG 组件；仅在 7 天真实数量未相等时附加填报图片。该参数目前不会被 n8n 调度调用，生产路由也未配置；不得因此切换现有个人收件人流程或进行群测试。

## 运行配置

运行前必须设置内部 API token：

```bash
export KDOS_API_BASE_URL=http://127.0.0.1/api/v1
export KDOS_NOTIFICATION_INTERNAL_TOKEN='由部署环境注入，不写入仓库'
export KDOS_DEFAULT_TENANT_CODE=KAINAN
python3 dispatcher.py --once --limit 1
```

API 会按规则解析正式接收人，并为每位可发送用户返回独立的 `deliveryId`、KDOS 用户 ID 和企业微信 UserId。Dispatcher 不解析、不合并、不替换接收人，而是逐项调用 `send_app_text(content, touser=wechatUserId)`，并仅回写当前 `deliveryId` 的成功或失败结果。没有内部 token 时程序拒绝运行。

`--once` 仅用于人工调试；不带 `--once` 时 Dispatcher 默认以约 1 秒间隔常驻轮询，单次 API/通知异常会记录并继续下一轮，收到 SIGTERM/SIGINT 后优雅退出。正式服务应使用
`/data/automation/code/work/basci/basic_code/.venv/bin/python` 启动本目录的 `dispatcher.py`，并通过独立的 systemd `EnvironmentFile` 注入 token。企业微信 secret 仍只由 `basic_code` 自己的 `.env` 管理，不支持群机器人回退。
