# KDOS 通知 Dispatcher

这是 KDOS `notification_outbox` 的主机端适配器。它只调用内部通知 API 和 `/data/automation/code/work/basci/basic_code` 中的默认 `WeChatPusher()`，不连接数据库、不查询设备责任人、不保存企业微信密钥，也不实现业务路由。

## 单人验证门禁

正式发送前必须设置内部 API token 和单人门禁。验证阶段只允许崔玮杰：

```bash
export KDOS_API_BASE_URL=http://127.0.0.1/api/v1
export KDOS_NOTIFICATION_INTERNAL_TOKEN='由部署环境注入，不写入仓库'
export KDOS_DEFAULT_TENANT_CODE=KAINAN
export KDOS_DISPATCHER_ALLOWED_RECIPIENT_NAME='崔玮杰'
python3 dispatcher.py --once --limit 1
```

`KDOS_DISPATCHER_ALLOWED_USER_ID` 可作为更稳定的实际测试接收人门禁。没有 token 或没有任何单人门禁时，程序直接拒绝运行。业务责任人由 API 正常解析并保留在投递日志中；TEST MODE 下 API 将实际投递目标覆盖为崔玮杰，多个业务责任人只返回一个实际投递项，并通过 `deliveryIds` 关联全部业务投递日志。Dispatcher 不解析业务责任人，也不把崔玮杰要求为设备责任人。

Dispatcher 默认只执行一次轮询，不支持群机器人回退。企业微信 secret 仍只由 `basic_code` 自己的 `.env` 管理。
