# Planning workflow contracts

Phase one does not deploy a workflow engine. `WorkflowGateway` in `packages/workflow-sdk` is the stable boundary through which Planning can request approval later.

| Workflow | Trigger | Expected protected change |
| --- | --- | --- |
| `planning.plan.publish` | publishing a draft | make the version official and create a snapshot |
| `planning.plan.major_change` | policy-defined major plan change | apply approved batch/structural changes |
| `planning.delivery_date.change` | material delivery-date change | update an approved due date |
| `planning.plan.unlock` | reopening a locked plan | return `LOCKED` to `PUBLISHED` with reason |
| `planning.period.close` | operational month close | prevent new operational changes |

Ordinary draft cell updates continue directly through Application Service and Audit. A future major-change command creates a change request, asks `WorkflowGateway`, and applies the actual plan mutation only after approval. Workflow callbacks and event consumers must be idempotent.

`PhaseOneWorkflowGateway` returns `NOT_REQUIRED`; this is explicit transitional behavior, not an approval engine. Flowable or another engine must be introduced behind the interface only when an approved business workflow and operational owner exist.
