import assert from "node:assert/strict";
import { v7 as uuidv7 } from "uuid";
import type { KnowledgeApplicationService } from "./knowledge.application.service";
import type { KnowledgeQueryService } from "./knowledge.query.service";
import type { KnowledgeActor } from "./knowledge.types";

/** Runs through real commands and scoped queries in the guarded disposable DB. */
export async function validateKnowledgePublication(
  app: KnowledgeApplicationService,
  query: KnowledgeQueryService,
  admin: KnowledgeActor,
  viewer: KnowledgeActor,
  spaceId: string,
  check: (label: string) => void,
) {
  const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "发布正文" }] }] };
  const page = await app.createPage({ spaceId, title: "发布状态验证", content: body, tags: ["甲", "乙"] }, admin);
  const changed = async (expected: boolean) => {
    assert.equal((await query.detail(page.id, { mode: "working" }, admin)).hasUnpublishedChanges, expected);
    if ((await query.detail(page.id, { mode: "working" }, admin)).publishedVersionId)
      assert.equal((await query.detail(page.id, {}, admin)).hasUnpublishedChanges, expected);
  };
  await changed(true);
  let version = (await app.publish(page.id, { expectedVersion: page.version }, admin)).version;
  await changed(false);
  assert.equal((await query.detail(page.id, {}, viewer)).hasUnpublishedChanges, undefined);
  const snapshot = (await query.detail(page.id, {}, admin)).publishedVersionId;
  assert.equal((await query.detail(page.id, { versionId: snapshot }, admin)).hasUnpublishedChanges, undefined);
  check("publication state: draft=true; freshly published rich text=false; readers/history receive no working-change flag");
  version = (await app.updatePage(page.id, { title: "仅改标题", expectedVersion: version }, admin)).version;
  await changed(true);
  assert.equal((await query.detail(page.id, {}, viewer)).title, "发布状态验证");
  version = (await app.updatePage(page.id, { title: "发布状态验证", expectedVersion: version }, admin)).version;
  await changed(false);
  check("publication state: title-only modification=true; restoring the published title=false despite technical version increments");
  version = (await app.updatePage(page.id, { content: body, sortOrder: 50, tags: ["乙", "甲"], expectedVersion: version }, admin)).version;
  await changed(false);
  check("publication state: identical autosave, display order and reordered tag input do not require a new version");
  version = (await app.updatePage(page.id, { description: "单独说明", expectedVersion: version }, admin)).version;
  await changed(true);
  version = (await app.publish(page.id, { expectedVersion: version }, admin)).version;
  await changed(false);
  version = (await app.updatePage(page.id, { tags: ["新标签"], expectedVersion: version }, admin)).version;
  await changed(true);
  version = (await app.publish(page.id, { expectedVersion: version }, admin)).version;
  await changed(false);
  check("publication state: description-only and tags-only changes detected; publication resets the flag");
  const replacement = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "新正文" }] }] };
  version = (await app.updatePage(page.id, { content: replacement, expectedVersion: version }, admin)).version;
  await changed(true);
  await assert.rejects(() => app.publish(page.id, { expectedVersion: version - 1 }, admin), /修改|版本/);
  await assert.rejects(async () => app.publish(page.id, { expectedVersion: version }, viewer), /权限/);
  assert.equal((await query.detail(page.id, { mode: "working" }, admin)).version, version);
  assert.equal((await query.detail(page.id, {}, viewer)).content.content[0].content[0].text, "发布正文");
  await assert.rejects(() => query.detail(page.id, {}, { ...admin, tenantId: uuidv7() }));
  check("publication state: body-only changes=true; stale publish/read-only publish/foreign tenant denied without changing the snapshot");
}
