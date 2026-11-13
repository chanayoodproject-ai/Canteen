import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, bangkokNow, daysInMonth, defaultUploadMonth, shiftMonth, hasTimeArrived } from "@/lib/time";
import { cleanDishText, ocrToDrafts, parseCsv, tableToDrafts } from "@/lib/parse-menu";
import { decideMenuQuestion } from "@/lib/menu-question";
import { parsePostback, buildFlexMessage } from "@/lib/flex";
import { isTransientDbError, withDbRetry } from "@/lib/server/db";

const settings = [
  { meal: "breakfast" as const, sendTime: "06:30" },
  { meal: "lunch" as const, sendTime: "11:00" },
  { meal: "dinner" as const, sendTime: "16:30" },
  { meal: "late" as const, sendTime: "20:30" },
];

test("bangkokNow uses Asia/Bangkok regardless of server zone", () => {
  // 2026-12-31 17:30 UTC = 2027-01-01 00:30 in Bangkok
  const now = bangkokNow(new Date("2026-12-31T17:30:00Z"));
  assert.equal(now.iso, "2027-01-01");
  assert.equal(now.hour, 0);
  assert.equal(now.minute, 30);
});

test("month and year rollover", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2027, 1, -1), { year: 2026, month: 12 });
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.deepEqual(defaultUploadMonth(bangkokNow(new Date("2026-12-20T05:00:00Z"))), { year: 2027, month: 1 });
  assert.deepEqual(defaultUploadMonth(bangkokNow(new Date("2027-01-03T05:00:00Z"))), { year: 2027, month: 1 });
});

test("send time arrival", () => {
  const now = bangkokNow(new Date("2026-11-13T04:00:00Z")); // 11:00 BKK
  assert.equal(hasTimeArrived(now, "11:00"), true);
  assert.equal(hasTimeArrived(now, "11:01"), false);
});

test("CSV import", () => {
  const rows = parseCsv('day,เช้า,เที่ยง,เย็น,ดึก\n"1","ข้าวต้ม","ผัดไทย","แกงเขียวหวาน","โจ๊ก"\n');
  const cells = tableToDrafts(rows, 2026, 12);
  assert.equal(cells.length, 4);
  assert.equal(cells.find((cell) => cell.meal === "lunch")?.dishText, "ผัดไทย");
});

test("OCR output conversion cleans prefixes and drops invalid days", () => {
  const cells = ocrToDrafts(
    {
      days: [
        { day: 1, breakfast: "เช้า: ข้าวต้มหมู", lunch: "ผัดกะเพรา\nไข่ดาว", dinner: "", late: "", review: ["dinner"] },
        { day: 31, breakfast: "x" },
        { day: 0, breakfast: "x" },
      ],
    },
    2026,
    11,
  );
  assert.equal(cells.find((cell) => cell.meal === "breakfast")?.dishText, "ข้าวต้มหมู");
  assert.equal(cells.find((cell) => cell.meal === "lunch")?.dishText, "ผัดกะเพรา ไข่ดาว");
  assert.equal(cells.find((cell) => cell.meal === "dinner")?.needsReview, true);
  assert.ok(cells.every((cell) => cell.day === 1));
  assert.deepEqual(ocrToDrafts(null, 2026, 11), []);
  assert.equal(cleanDishText("มื้อเที่ยง: ลาบหมู"), "ลาบหมู");
});

test("menu question decisions", () => {
  const morning = bangkokNow(new Date("2026-11-13T02:00:00Z")); // 09:00
  assert.deepEqual(decideMenuQuestion("มื้อเที่ยงมีอะไรกิน", morning, settings), { kind: "ask", meal: "lunch" });
  assert.deepEqual(decideMenuQuestion("เช้านี้มีอะไรกิน", bangkokNow(new Date("2026-11-13T10:00:00Z")), settings), {
    kind: "over",
    meal: "breakfast",
  });
  assert.deepEqual(decideMenuQuestion("สวัสดี", morning, settings), { kind: "ignore" });
});

test("rating postback round trip", () => {
  const flex = buildFlexMessage({ date: "2027-01-01", meal: "late", dishText: "โจ๊ก" });
  const json = JSON.stringify(flex);
  const data = /k=menu&d=2027-01-01&m=late&s=5/.exec(json)?.[0];
  assert.ok(data);
  assert.deepEqual(parsePostback(data!), { ok: true, kind: "menu", date: "2027-01-01", meal: "late", score: 5 });
  assert.deepEqual(parsePostback("k=menu&d=2027-01-01&m=late&s=9"), { ok: false });
});

test("db retry only retries transient errors", async () => {
  let calls = 0;
  const value = await withDbRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("boom"), { code: "CONNECTION_CLOSED" });
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(calls, 2);
  assert.equal(isTransientDbError(Object.assign(new Error("dup"), { code: "23505" })), false);
  await assert.rejects(withDbRetry(async () => { throw Object.assign(new Error("dup"), { code: "23505" }); }));
});
