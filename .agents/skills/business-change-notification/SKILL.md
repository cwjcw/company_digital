---
name: business-change-notification
description: KDOS business notifications triggered by persisted field changes, task assignment or reassignment, including enterprise WeChat delivery. Use when adding or changing notification rules, recipients, payloads, deduplication, or transactional delivery; not for unrelated UI copy or generic message wording.
---

# KDOS 业务变更通知

Use this Skill when a KDOS change sends a notification because business data changed or a task was assigned/reassigned. Read the root `AGENTS.md` and the relevant module docskill first. The module docskill defines which changes merit notification, lifecycle eligibility, recipients, and message content; this Skill defines reusable engineering constraints and does not create new business events by itself.

## Change detection and notification decisions

- Notify only after comparing the persisted before/after business values. Normalize values according to their domain (for example, stable IDs for member/department selectors and ordered or set semantics for collections as defined by the contract). Ignore timestamps, versions, audit fields, derived display values, and no-op saves unless the module contract explicitly treats them as meaningful changes.
- Make the triggering field set explicit in the module contract. Distinguish primary business fields, assignment/configuration fields, and task work-in-progress fields. Do not treat every database update as a business notification.
- Re-check the record's current state and recipient after applying the change. Do not notify deleted, cancelled, completed, or otherwise ineligible records unless the module contract explicitly requires it.
- For reassignment, resolve the recipient from the saved current assignee in the same tenant. Notify the new assignee for an eligible task; never trust a client-supplied recipient. Subsequent reminders and change notices target the current assignee. Do not silently retain the former assignee as a recipient.
- Decide explicitly whether a change to a parent record affects all open child tasks or only one task. List which fields propagate a notice to which eligible records.

## Transaction, idempotency, and delivery

- Persist the business change, audit record, and notification outbox entry in the same database transaction. A failed business transaction must not leave a deliverable notification; a failed outbox insert must roll back the business change when the contract requires atomic notification intent.
- Use the existing notification/outbox and dispatcher path. Do not introduce a second queue, scheduler, timer, or direct send from a request handler when the existing path supports the event.
- Make event creation idempotent across request retries and duplicate consumers. Define a stable deduplication identity from the business record, event/change version, event type, and recipient as appropriate. A repeated no-op save or idempotent command replay must not create another message.
- Delivery retries must reuse the existing notification status, retry, and logging mechanisms. Record a clear failure when the recipient has no valid enterprise WeChat identity; do not report a send as successful when it was skipped.
- Keep payloads limited to information needed to act. Use stable in-application links and re-check authentication, tenant, record scope, and field permissions after navigation; a notification or link grants no business access.

## Enterprise WeChat

- Reuse the project's `WeChatPusher` from `/data/automation/code/work/basci/basic_code`; do not copy credentials into this repository. `WeChatPusher()` uses the Planning Center default self-built app. Use `WeChatPusher(app="...")` only when the module has an explicitly configured business app.
- Robot delivery is allowed only through an explicit `send_robot_*()` call. Never silently fall back from self-built app delivery to a group robot.
- Keep enterprise WeChat transport behind the existing notification delivery boundary. Business services should create a domain notification/outbox event, not call the external client directly.

## Contract and verification

- Document event type, trigger fields, lifecycle/state eligibility, recipient resolution, message fields/link, deduplication identity, transaction boundary, retry/failure behavior, and whether reassignment notifies the former assignee.
- When business fields, access rules, or task state are also changed, follow `kdos-form-platform` and the relevant module rules. When a scheduler or runtime task is changed, also follow `kdos-task-orchestration` and its task registry.
- Validate the changed path at the smallest meaningful level: actual-delta detection, recipient after reassignment, tenant isolation, ineligible states, rollback with outbox failure, retry/idempotency, and payload/link authorization. Report checks that were not run; do not imply code or production delivery was verified by a document-only review.
