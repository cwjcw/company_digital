# 评审交期表 JSON 批量导入 API

## Endpoint

`POST /api/v1/master-plan-system/review-due-dates/bulk-import`

- 认证：KDOS Bearer access token。
- 权限：评审交期资源同时需要 `import` 和 `create`；每个填写字段还需获准新增字段权限；租户和事业部数据范围由认证上下文及服务端重新校验。
- 单次上限：500 条。
- 事务策略：原子整批。任一行校验失败或业务键重复，整批不写入；响应逐行报告错误与未写入原因。
- 幂等：`commandId` 为 UUID，按租户、用户、命令号隔离。相同命令号和相同请求返回原结果并将 `repeated` 置为 `true`；同命令号不同内容返回 HTTP 409。失败校验结果也会保存，修改后须使用新的 `commandId`。
- 不支持更新；本接口只批量新增。更新继续使用手工编辑或 Excel 标准导入。

## Request

`rows[].values` 使用当前 Contracts 中的 camelCase 字段键。必填字段为 `divisionId`、`orderNumber`、`batchNumber`、`drawingNumber`、`quantity`。日期使用严格 `YYYY-MM-DD`；`quantity` 使用十进制字符串。事业部 ID 必须是当前允许的事业部或采购部目录 ID。

```json
{
  "commandId": "0199ea00-0000-7000-8000-000000000099",
  "rows": [
    {
      "row": 1,
      "values": {
        "divisionId": "0199ea00-0000-7000-8000-000000000002",
        "orderNumber": "2026A000001",
        "batchNumber": "TGH123-1/1",
        "drawingNumber": "TGH123",
        "orderDate": "2026-11-09",
        "productReviewDueDate": "2026-12-10",
        "inspectionTimeName": "合成品项",
        "quantity": "12.500",
        "inboundDate": null
      }
    }
  ]
}
```

## Success response

HTTP 200. A validation-rejected atomic batch also returns HTTP 200 with `succeeded: 0`, `failed` equal to the batch size, and row-level errors; malformed envelopes are HTTP 400, missing authorization is HTTP 403, and an idempotency-key payload mismatch is HTTP 409.

```json
{
  "batchId": "0199ea00-0000-7000-8000-000000000099",
  "total": 1,
  "succeeded": 1,
  "failed": 0,
  "atomic": true,
  "repeated": false,
  "errors": [],
  "records": [{ "row": 1, "id": "0199ea00-0000-7000-8000-000000000101", "version": 1 }]
}
```

## Row failure response

```json
{
  "batchId": "0199ea00-0000-7000-8000-000000000099",
  "total": 2,
  "succeeded": 0,
  "failed": 2,
  "atomic": true,
  "repeated": false,
  "errors": [
    { "row": 1, "reason": "客户交期必须为有效业务日期" },
    { "row": 2, "reason": "原子批次中其他行校验失败；本批没有写入" }
  ],
  "records": []
}
```

## curl

```sh
curl --fail-with-body \
  -H 'Authorization: Bearer <KDOS_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  --data @review-due-dates.json \
  'https://<KDOS_HOST>/api/v1/master-plan-system/review-due-dates/bulk-import'
```

Use a secret store or shell prompt for the token; do not save a real token in the JSON file, shell history, or logs. The API writes only `mps_review_due_dates`, its standard system audit, and the idempotency receipt; it does not call plan services or create Outbox work.
