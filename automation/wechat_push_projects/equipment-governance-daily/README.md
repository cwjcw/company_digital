# 设备治理企业微信图片日报

按事业部统计设备总台账中的监测设备和已指定责任人的设备数量，并结合 `training_status.txt` 生成 BI 风格图片。统计范围固定为事业一部、事业二部、事业三部、事业四部；研发中心不在本次通报范围内。发送时严格先发送图片，图片接口返回成功后等待 15 秒，再发送“设备管理上线进度表 截至前一天日期”的文字消息；图片失败时不发送文字。等待时长可通过 `config.json` 中的 `text_delay_seconds` 调整。

业务规则：监测数量为 0 时显示“未提交需要监测的设备”；责任人设备数量为 0 时显示“未提交设备管理责任人”；任一数量为 0 时显示“培训条件未满足”，两项均大于 0 时才展示文本文件中的培训日期和情况。

运行环境使用 `/data/automation/code/work/basci/basic_code/.venv/bin/python`，企业微信密钥只从该工具包自己的 `.env` 读取。

```bash
# 只生成在线数据图片，不发送
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py

# 单人测试，只发给崔玮杰
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py --send-test

# 正式发送，必须显式二次确认
/data/automation/code/work/basci/basic_code/.venv/bin/python report.py --send-production --confirm-production

# 单元测试
/data/automation/code/work/basci/basic_code/.venv/bin/python -m unittest -v test_report.py
```

图片生成到仓库已忽略的 `data/wechat-push/equipment-governance-daily/latest.png`。首次上线只执行单人测试。因需求尚未指定每日发送时间，本项目暂不安装或启用周期定时器；确认时间后再以本目录为单位增加服务和定时器。

## N8N

当前 N8N 运行在容器中，容器内没有 Docker 命令、Python 运行环境，也没有挂载本项目，因此不要直接使用本地 `Execute Command` 节点。使用 N8N 的 `SSH` 节点连接宿主机后，把下列命令放入该节点的 `Command`：

```bash
cd /data/automation/code/work/PMC/knweb/automation/wechat_push_projects/equipment-governance-daily && /data/automation/code/work/basci/basic_code/.venv/bin/python report.py --send-production --confirm-production
```

SSH 主机可使用 N8N 容器所见的宿主机网关 `172.19.0.1`，用户为 `Jerry`；认证信息保存在 N8N 的 SSH Credential 中，不得写入命令。节点成功时输出 JSON，其中应包含 `"sent": true`、`"imageErrcode": 0`、`"textErrcode": 0`、`"textDelaySeconds": 15`、`"recipientCount": 11`；命令非零退出时让工作流直接失败，不要继续执行成功分支。
