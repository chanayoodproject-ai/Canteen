import { test } from "node:test";
import assert from "node:assert/strict";
import { isGoneFromTarget, planTargets, summarizeTargets } from "../lib/line-target-plan";
import { questionTargetId } from "../lib/server/ask-menu";
import { store } from "../lib/server/store";

test("auto-send goes to every active group unless LINE_TARGET_ID overrides", () => {
  const rows = [
    { id: "Cgroup1", active: true },
    { id: "Cgroup2", active: false },
    { id: "Rroom1", active: true },
    { id: "Cgroup1", active: true },
  ];
  assert.deepEqual(planTargets(undefined, rows), ["Cgroup1", "Rroom1"]);
  assert.deepEqual(planTargets("  Cforced ", rows), ["Cforced"]);
  assert.deepEqual(planTargets("", []), []);
});

test("only 'not a member' style errors stop sending to a group", () => {
  assert.equal(isGoneFromTarget(400, '{"message":"The bot is not a member of the group"}'), true);
  assert.equal(isGoneFromTarget(400, `{"message":"The property, 'to', in the request body is invalid"}`), true);
  // Account-wide problems must never deactivate groups.
  assert.equal(isGoneFromTarget(403, '{"message":"You are not allowed to use this API."}'), false);
  assert.equal(isGoneFromTarget(429, '{"message":"You have reached your monthly limit."}'), false);
  assert.equal(isGoneFromTarget(400, '{"message":"A message (messages[0]) in the request body is invalid"}'), false);
  assert.equal(isGoneFromTarget(500, "not a member"), false);
});

test("per-meal summary across groups", () => {
  assert.equal(summarizeTargets([]).status, "skipped");
  const mixed = summarizeTargets([
    { target: "Cg1…", status: "sent", detail: "" },
    { target: "Cg2…", status: "failed", detail: "x" },
  ]);
  assert.equal(mixed.status, "partial");
  assert.equal(summarizeTargets([{ target: "a", status: "would_send", detail: "" }, { target: "b", status: "would_send", detail: "" }]).detail, "จะส่งเข้า 2 กลุ่ม");
  assert.equal(summarizeTargets([{ target: "a", status: "skipped", detail: "กลุ่มนี้ถามเมนูไปแล้ว" }]).status, "skipped");
});

test("menu question marks only the asking group", () => {
  assert.equal(questionTargetId({ type: "group", groupId: "Cabc" }), "Cabc");
  assert.equal(questionTargetId({ type: "room", roomId: "Rxyz" }), "Rxyz");
  assert.equal(questionTargetId({ type: "user", userId: "U1" }), "");
});

test("send logs dedupe per (date, meal, group)", async () => {
  // In-memory store (no DATABASE_URL in tests).
  const base = { menuDate: "2031-01-02", meal: "lunch" as const, target: null, detail: "t" };
  assert.ok(await store.insertLog({ ...base, status: "sent", targetId: "Cg1" }));
  assert.equal(await store.insertLog({ ...base, status: "claimed", targetId: "Cg1" }), null);
  assert.ok(await store.insertLog({ ...base, status: "claimed", targetId: "Cg2" }));
  assert.equal((await store.latestLog(base.menuDate, "lunch", ["sent"], "Cg1"))?.targetId, "Cg1");
  assert.equal(await store.latestLog(base.menuDate, "lunch", ["sent"], "Cg3"), null);
});
