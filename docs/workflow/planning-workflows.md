# Planning workflow contracts

Phase one does not deploy a workflow engine. `WorkflowGateway` in `packages/workflow-sdk` is the stable boundary through which Planning can request approval later.

## Shared human-approval policy

All human approval flows must use `approvalCapabilities` from `packages/workflow-sdk`; business modules define their own stages and assignees and expose their runtime policy through `approval_flow_configs`:

- the creation stage supports explicit submission and can optionally allow incomplete drafts;
- the actor who moved work to the next stage may optionally withdraw it while that stage has not acted;
- the current-stage actor may return work to any earlier non-terminal stage, or only the immediately previous stage, and must provide a reason;
- approval nodes expose separate pass, return and reject actions; rejection returns to the configured draft or immediately previous stage and always requires a reason;
- completed/terminal instances cannot be withdrawn or returned.

The “需求与开发” module is the first runtime implementation of this policy. System and group administrators manage flow enablement, draft/withdraw behavior, return and reject rules, approval-comment requirements, administrator-node roles and node labels on the “审批流程配置” page. Configuration-page access and mandatory return/reject reasons are fixed safety controls. Planning workflow types below remain gateway contracts until their approval instances and owners are activated.

| Workflow | Trigger | Expected protected change |
| --- | --- | --- |
| `planning.plan.publish` | publishing a draft | make the version official and create a snapshot |
| `planning.plan.major_change` | policy-defined major plan change | apply approved batch/structural changes |
| `planning.delivery_date.change` | material delivery-date change | update an approved due date |
| `planning.plan.unlock` | reopening a locked plan | return `LOCKED` to `PUBLISHED` with reason |
| `planning.period.close` | operational month close | prevent new operational changes |

Ordinary draft cell updates continue directly through Application Service and Audit. A future major-change command creates a change request, asks `WorkflowGateway`, and applies the actual plan mutation only after approval. Workflow callbacks and event consumers must be idempotent.

`PhaseOneWorkflowGateway` returns `NOT_REQUIRED`; this is explicit transitional behavior, not an approval engine. Flowable or another engine must be introduced behind the interface only when an approved business workflow and operational owner exist.
