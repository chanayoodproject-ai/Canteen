import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, bangkokNow, daysInMonth, defaultUploadMonth, shiftMonth, hasTimeArrived } from "@/lib/time";
import { cleanDishText, ocrToDrafts, parseCsv, tableToDrafts } from "@/lib/parse-menu";
import {
  decideMenuQuestion,
  isDuplicateMenuReply,
  parseMenuQuestionDate,
  REPLY_DEDUPE_MS,
} from "@/lib/menu-question";
import { skipReasonForTarget } from "@/lib/server/send";
import { store } from "@/lib/server/store";
import { buildFlexMessage, menuLineShouldWrap, menuTextSize, thaiDisplayLength } from "@/lib/flex";
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
  const morning = bangkokNow(new Date("2026-11-13T02:00:00Z")); // Friday 09:00 BKK
  assert.deepEqual(decideMenuQuestion("มื้อเที่ยงมีอะไรกิน", morning, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["lunch"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("เช้านี้มีอะไรกิน", bangkokNow(new Date("2026-11-13T10:00:00Z")), settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["breakfast"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("สวัสดี", morning, settings), { kind: "ignore" });
});

test("menu questions understand Thai dates and stay silent about the past", () => {
  const fridayMorning = bangkokNow(new Date("2026-11-13T02:00:00Z")); // 09:00 BKK, Friday
  const fridayAfternoon = bangkokNow(new Date("2026-11-13T07:00:00Z")); // 14:00 BKK

  assert.equal(parseMenuQuestionDate("พรุ่งนี้กินอะไร", fridayMorning).date, "2026-11-14");
  assert.equal(parseMenuQuestionDate("มะรืนนี้มื้อเย็น", fridayMorning).date, "2026-11-15");
  assert.equal(parseMenuQuestionDate("เมื่อวานกินอะไร", fridayMorning).date, "2026-11-12");
  assert.equal(parseMenuQuestionDate("วันที่ 20 มื้อเที่ยง", fridayMorning).date, "2026-11-20");
  assert.equal(parseMenuQuestionDate("วันที่ 10", fridayMorning).date, "2026-11-10");
  assert.equal(parseMenuQuestionDate("20 พ.ย. 2569", fridayMorning).date, "2026-11-20");
  assert.equal(parseMenuQuestionDate("20/11/69 กินอะไร", fridayMorning).date, "2026-11-20");
  assert.equal(parseMenuQuestionDate("2 มกราคม", fridayMorning).date, "2027-01-02");
  assert.equal(parseMenuQuestionDate("วันจันทร์กินอะไร", fridayMorning).date, "2026-11-16");
  assert.equal(parseMenuQuestionDate("วันศุกร์กินอะไร", fridayMorning).date, "2026-11-13");
  assert.equal(parseMenuQuestionDate("วันจันทร์นี้", fridayMorning).date, "2026-11-09");
  assert.equal(parseMenuQuestionDate("วันจันทร์หน้า", fridayMorning).date, "2026-11-16");
  assert.equal(parseMenuQuestionDate("วันศุกร์ที่แล้ว", fridayMorning).date, "2026-11-06");

  assert.deepEqual(decideMenuQuestion("พรุ่งนี้กินอะไร", fridayMorning, settings), {
    kind: "ask",
    date: "2026-11-14",
    meals: ["breakfast", "lunch", "dinner", "late"],
    day: "future",
  });
  assert.deepEqual(decideMenuQuestion("วันที่ 20 มื้อเที่ยง", fridayMorning, settings), {
    kind: "ask",
    date: "2026-11-20",
    meals: ["lunch"],
    day: "future",
  });
  assert.deepEqual(decideMenuQuestion("เมื่อวานกินอะไร", fridayMorning, settings), {
    kind: "past",
    date: "2026-11-12",
    meals: [],
  });
  assert.deepEqual(decideMenuQuestion("วันที่ 10 มื้อเย็นกินอะไร", fridayMorning, settings), {
    kind: "past",
    date: "2026-11-10",
    meals: ["dinner"],
  });
  // Unspecified meal today: the next meal that has not been sent yet (lunch at 09:00, dinner at 14:00).
  assert.deepEqual(decideMenuQuestion("มีอะไรกิน", fridayMorning, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["lunch"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("มีอะไรกิน", fridayAfternoon, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["dinner"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("มื้อเย็นกินอะไร", fridayAfternoon, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["dinner"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("มื้อเที่ยงกินอะไร", fridayAfternoon, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["lunch"],
    day: "today",
  });
  const fridayNight = bangkokNow(new Date("2026-11-13T14:00:00Z")); // 21:00 BKK, after late
  assert.deepEqual(decideMenuQuestion("มีอะไรกิน", fridayNight, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["breakfast", "lunch", "dinner", "late"],
    day: "today",
  });
  assert.deepEqual(decideMenuQuestion("มื้อดึกกินอะไร", fridayNight, settings), {
    kind: "ask",
    date: "2026-11-13",
    meals: ["late"],
    day: "today",
  });
  assert.equal(decideMenuQuestion("วันนี้ไปไหน", fridayMorning, settings).kind, "ignore");
});

test("same-day menu questions are answered even after a push, with a 1-minute dedupe", () => {
  const first = {
    targetId: "Cg-group-1",
    menuDate: "2026-11-16",
    questionNorm: "มีอะไรกิน",
    meals: ["lunch" as const],
    at: 1_000_000,
  };
  assert.equal(
    isDuplicateMenuReply([first], {
      targetId: "Cg-group-1",
      menuDate: "2026-11-16",
      questionNorm: "มีอะไรกิน",
      meals: ["lunch"],
      nowMs: 1_000_000 + 30_000,
    }),
    true,
  );
  assert.equal(
    isDuplicateMenuReply([first], {
      targetId: "Cg-group-1",
      menuDate: "2026-11-16",
      questionNorm: "มีอะไรกิน",
      meals: ["lunch"],
      nowMs: 1_000_000 + REPLY_DEDUPE_MS,
    }),
    false,
  );
  assert.equal(
    isDuplicateMenuReply([first], {
      targetId: "Cg-group-1",
      menuDate: "2026-11-16",
      questionNorm: "มื้อเที่ยงกินอะไร",
      meals: ["lunch"],
      nowMs: 1_000_000 + 30_000,
    }),
    false,
  );
  assert.equal(
    isDuplicateMenuReply([first], {
      targetId: "Cg-other",
      menuDate: "2026-11-16",
      questionNorm: "มีอะไรกิน",
      meals: ["lunch"],
      nowMs: 1_000_000 + 30_000,
    }),
    false,
  );
});

test("cron skips a group that already asked today's meal", async () => {
  assert.equal(skipReasonForTarget({ asked: true, log: null }), "กลุ่มนี้ถามเมนูไปแล้ว");
  assert.equal(skipReasonForTarget({ asked: false, log: { status: "sent", detail: "ส่งเข้า LINE แล้ว" } }), "ส่งมื้อนี้ไปแล้ววันนี้");
  assert.equal(skipReasonForTarget({ asked: false, log: { status: "claimed", detail: "กำลังส่ง" } }), "มีงานส่งมื้อนี้อยู่แล้ว");
  assert.equal(skipReasonForTarget({ asked: false, log: { status: "sent", detail: "ตอบคำถามในแชทแล้ว" } }), "กลุ่มนี้ถามเมนูไปแล้ว");
  assert.equal(skipReasonForTarget({ asked: false, log: null }), null);

  const key = { menuDate: "2031-03-04", meal: "dinner" as const, targetId: "Cg-ask-1" };
  assert.equal(await store.hasMenuAsk(key.menuDate, key.meal, key.targetId), false);
  assert.equal(await store.recordMenuAsk(key), true);
  assert.equal(await store.recordMenuAsk(key), false);
  assert.equal(await store.hasMenuAsk(key.menuDate, key.meal, key.targetId), true);
  assert.equal(await store.hasMenuAsk(key.menuDate, key.meal, "Cg-other"), false);
  assert.equal(
    skipReasonForTarget({ asked: await store.hasMenuAsk(key.menuDate, key.meal, key.targetId), log: null }),
    "กลุ่มนี้ถามเมนูไปแล้ว",
  );
});

test("flex message shows large menu text without rating buttons", () => {
  const flex = buildFlexMessage({ date: "2027-01-01", meal: "late", dishText: "โจ๊กหมู" });
  const json = JSON.stringify(flex);
  assert.equal(flex.type, "flex");
  assert.match(flex.altText, /โจ๊กหมู/);
  assert.equal(json.includes("postback"), false);
  assert.equal(json.includes("ให้คะแนน"), false);
  assert.equal(json.includes("k=menu"), false);
  assert.equal("footer" in flex.contents, false);
  assert.equal("hero" in flex.contents, false);
  const bubble = flex.contents;
  const body = bubble.body as { contents?: Array<Record<string, unknown>>; height?: unknown; paddingAll?: unknown };
  assert.equal(bubble.height, undefined);
  assert.equal(body.height, undefined);
  assert.equal(json.includes('"minHeight"'), false);
  assert.equal(json.includes('"aspectRatio"'), false);
  const dish = body.contents?.find((item) => item.text === "โจ๊กหมู");
  assert.ok(dish);
  assert.equal(dish.size, "4xl");
  assert.equal(dish.wrap, false);
  assert.equal(dish.adjustMode, "shrink-to-fit");
  assert.equal(dish.weight, "bold");
});

test("Thai display length ignores combining vowel and tone marks", () => {
  assert.equal(thaiDisplayLength("ต้ม"), 2); // ต้ + ม, not 3 code units
  assert.equal(thaiDisplayLength("โจ๊กหมู"), 5);
  assert.equal(thaiDisplayLength("ผัดไทย"), 5);
  assert.equal(thaiDisplayLength("ต้มจืดมะระยัดไส้ไก่"), 14);
  assert.equal(thaiDisplayLength("ต้มจืดมะระยัดไส้ไก่"), [..."ต้มจืดมะระยัดไส้ไก่"].length - 5);
});

test("flex dish text size steps down with the longest dish", () => {
  assert.equal(menuTextSize("ผัดไทย"), "4xl");
  assert.equal(menuTextSize("โจ๊กหมู"), "4xl");
  assert.equal(menuTextSize("ข้าวหน้าไก่"), "4xl"); // 8
  assert.equal(menuTextSize("หมูผัดพริกขิง"), "3xl"); // 9
  assert.equal(menuTextSize("ข้าวผัดต้มยำไก่"), "3xl"); // 10
  assert.equal(menuTextSize("ก๋วยเตี๋ยวคั่วไก่"), "xxl"); // 11
  assert.equal(menuTextSize("ต้มจืดผักกาดขาว"), "xxl"); // 12
  assert.equal(menuTextSize("แกงเขียวหวานไก่"), "xl"); // 13
  assert.equal(menuTextSize("ต้มจืดมะระยัดไส้ไก่"), "xl"); // 14, one line via shrink-to-fit
  assert.equal(menuTextSize("กวางตุ้งหมูสับน้ำมันหอย"), "lg"); // 16
  // Size follows the longest line in the message so both lines match.
  assert.equal(menuTextSize("ผัดไทย\nต้มจืดมะระยัดไส้ไก่"), "xl");
  assert.equal(menuLineShouldWrap("ต้มจืดมะระยัดไส้ไก่"), false);
  assert.equal(menuLineShouldWrap("กระเพราลูกชิ้นปลากรายหน่อไม้เหลือง ต้มจืดไข่น้ำ"), true);

  const long = buildFlexMessage({ date: "2027-01-01", meal: "lunch", dishText: "ต้มจืดมะระยัดไส้ไก่" });
  const body = long.contents.body as { contents?: Array<Record<string, unknown>> };
  const dish = body.contents?.find((item) => item.text === "ต้มจืดมะระยัดไส้ไก่");
  assert.ok(dish);
  assert.equal(dish.size, "xl");
  assert.equal(dish.wrap, false);
  assert.equal(dish.adjustMode, "shrink-to-fit");

  const two = buildFlexMessage({
    date: "2027-01-01",
    meal: "lunch",
    dishText: "กระเพราลูกชิ้นปลากรายหน่อไม้เหลือง ต้มจืดไข่น้ำ",
  });
  const twoBody = two.contents.body as { contents?: Array<Record<string, unknown>> };
  const twoDish = twoBody.contents?.find((item) => String(item.text).includes("หน่อไม้เหลือง"));
  assert.ok(twoDish);
  assert.equal(twoDish.size, "lg");
  assert.equal(twoDish.wrap, true);
  assert.equal(twoDish.adjustMode, undefined);
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
