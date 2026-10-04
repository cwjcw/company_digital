# KDOS 通知 Dispatcher

这是 KDOS `notification_outbox` 的主机端适配器。它只调用内部通知 API 和 `/data/automation/code/work/basci/basic_code` 中的默认 `WeChatPusher()`，不连接数据库、不查询设备责任人、不保存企业微信密钥，也不实现业务路由。

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
