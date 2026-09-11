# 表格前十行导出与企业微信发送

一次性导出当前线上“销售接单明细”和指定月份的月度计划前十条数据，并使用计划中心默认自建应用发送 Excel 文件。

- 数据读取使用短时内部访问令牌，业务查询仍经过线上 API 的租户和权限边界。
- 企业微信只使用 `/data/automation/code/work/basci/basic_code` 的 `WeChatPusher`，本目录不保存密钥。
- `generate-preview.mjs` 在 API 容器中执行；`send.py` 在主机中发送已生成的文件。
