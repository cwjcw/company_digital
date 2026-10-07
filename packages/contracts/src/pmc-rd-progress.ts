import type { TablePermissionFieldDefinition } from "./index";
export const pmcRdProgressFields: TablePermissionFieldDefinition[] = [
  {
    "key": "sourceOrderId",
    "label": "来源订单ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "sourceOrderLineId",
    "label": "来源订单行ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "orderNo",
    "label": "订单号",
    "type": "text",
    "editable": false
  },
  {
    "key": "lineNumber",
    "label": "行号",
    "type": "number",
    "editable": false
  },
  {
    "key": "customerId",
    "label": "客户ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "customerCode",
    "label": "客户编码",
    "type": "text",
    "editable": false
  },
  {
    "key": "customerName",
    "label": "客户名称",
    "type": "text",
    "editable": false
  },
  {
    "key": "orderDate",
    "label": "下单日期",
    "type": "date",
    "editable": false
  },
  {
    "key": "orderCreateDate",
    "label": "订单创建时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "orderLastModifiedDate",
    "label": "订单修改时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "ownerDeptId",
    "label": "E10部门ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "ownerDeptName",
    "label": "E10部门名称",
    "type": "text",
    "editable": false
  },
  {
    "key": "orderStatusRaw",
    "label": "订单原始审核状态",
    "type": "text",
    "editable": false
  },
  {
    "key": "divisionId",
    "label": "事业部",
    "type": "department",
    "editable": false
  },
  {
    "key": "divisionName",
    "label": "事业部名称",
    "type": "text",
    "editable": false
  },
  {
    "key": "divisionSource",
    "label": "事业部来源",
    "type": "text",
    "editable": false
  },
  {
    "key": "itemId",
    "label": "品项ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "itemCode",
    "label": "品号",
    "type": "text",
    "editable": false
  },
  {
    "key": "itemName",
    "label": "品名",
    "type": "text",
    "editable": false
  },
  {
    "key": "itemSpec",
    "label": "规格",
    "type": "text",
    "editable": false
  },
  {
    "key": "itemFeatureId",
    "label": "特征码",
    "type": "text",
    "editable": false
  },
  {
    "key": "businessQty",
    "label": "数量",
    "type": "number",
    "editable": false
  },
  {
    "key": "itemProperty",
    "label": "物料属性",
    "type": "text",
    "editable": false
  },
  {
    "key": "routingControl",
    "label": "路线控制",
    "type": "text",
    "editable": false
  },
  {
    "key": "standardRoutingId",
    "label": "标准路线ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "plantOrgId",
    "label": "工厂ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "designBomStatus",
    "label": "设计BOM状态",
    "type": "dictionary",
    "editable": false,
    "options": [
      {
        "value": "NOT_APPLICABLE",
        "label": "不适用"
      },
      {
        "value": "NOT_STARTED",
        "label": "未开始"
      },
      {
        "value": "IN_PROGRESS",
        "label": "进行中"
      },
      {
        "value": "COMPLETE",
        "label": "研发完成"
      },
      {
        "value": "ABNORMAL",
        "label": "异常"
      }
    ]
  },
  {
    "key": "bomId",
    "label": "设计BOM ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "bomVersion",
    "label": "BOM版本",
    "type": "text",
    "editable": false
  },
  {
    "key": "bomECode",
    "label": "BOM E_CODE",
    "type": "text",
    "editable": false
  },
  {
    "key": "bomApproveStatus",
    "label": "BOM原始审核状态",
    "type": "text",
    "editable": false
  },
  {
    "key": "validBomDetailCount",
    "label": "有效BOM明细数",
    "type": "number",
    "editable": false
  },
  {
    "key": "routingStatus",
    "label": "工艺路线状态",
    "type": "dictionary",
    "editable": false,
    "options": [
      {
        "value": "NOT_APPLICABLE",
        "label": "不适用"
      },
      {
        "value": "NOT_STARTED",
        "label": "未开始"
      },
      {
        "value": "IN_PROGRESS",
        "label": "进行中"
      },
      {
        "value": "COMPLETE",
        "label": "研发完成"
      },
      {
        "value": "ABNORMAL",
        "label": "异常"
      }
    ]
  },
  {
    "key": "routingId",
    "label": "路线ID",
    "type": "text",
    "editable": false
  },
  {
    "key": "routingCode",
    "label": "路线编码",
    "type": "text",
    "editable": false
  },
  {
    "key": "routingApproveStatus",
    "label": "路线原始审核状态",
    "type": "text",
    "editable": false
  },
  {
    "key": "validOperationCount",
    "label": "有效工序数",
    "type": "number",
    "editable": false
  },
  {
    "key": "routingSource",
    "label": "路线来源",
    "type": "text",
    "editable": false
  },
  {
    "key": "rdStatus",
    "label": "研发状态",
    "type": "dictionary",
    "editable": false,
    "options": [
      {
        "value": "NOT_APPLICABLE",
        "label": "不适用"
      },
      {
        "value": "NOT_STARTED",
        "label": "未开始"
      },
      {
        "value": "DESIGN_IN_PROGRESS",
        "label": "设计 BOM 进行中"
      },
      {
        "value": "WAITING_ROUTING",
        "label": "待工艺"
      },
      {
        "value": "ROUTING_IN_PROGRESS",
        "label": "工艺设计中"
      },
      {
        "value": "COMPLETE",
        "label": "研发完成"
      },
      {
        "value": "ABNORMAL",
        "label": "异常"
      }
    ]
  },
  {
    "key": "reasonCode",
    "label": "原因代码",
    "type": "text",
    "editable": false
  },
  {
    "key": "reasonText",
    "label": "原因说明",
    "type": "text",
    "editable": false
  },
  {
    "key": "rdLastModifiedAt",
    "label": "研发修改时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "sourceOrderModifiedAt",
    "label": "来源订单修改时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "sourceBomModifiedAt",
    "label": "来源BOM修改时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "sourceRoutingModifiedAt",
    "label": "来源路线修改时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "sourceSnapshotAt",
    "label": "源数据观察时间",
    "type": "datetime",
    "editable": false
  },
  {
    "key": "syncedAt",
    "label": "同步时间",
    "type": "datetime",
    "editable": false
  }
];
