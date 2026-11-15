import { test } from "node:test";
import assert from "node:assert/strict";
import { bangkokNow } from "@/lib/time";
import { isWithinAutoSendWindow as sendWindow } from "@/lib/server/send";
import {
  defaultSendPlan,
  nextSlot,
  normalizeSendPlan,
  planInEffect,
  projectQuota,
  pushesPerDay,
  remainingSlotsToday,
  skipReasonForSlot,
  slotsFromPlan,
  validateSendPlan,
} from "@/lib/send-plan";
import { buildFlexMessage, buildMenuFlex } from "@/lib/flex";

const settings = [
  { meal: "breakfast" as const, sendTime: "06:30", enabled: true },
  { meal: "lunch" as const, sendTime: "11:00", enabled: true },
  { meal: "dinner" as const, sendTime: "16:30", enabled: true },
  { meal: "late" as const, sendTime: "20:30", enabled: true },
];

test("daily plan is one combined slot at 07:00 and starts on 16 Nov 2026", () => {
  const plan = defaultSendPlan();
  assert.equal(plan.mode, "daily");
  assert.equal(plan.dailyTime, "07:00");
  assert.equal(plan.effectiveFrom, "2026-11-16");
  assert.equal(plan.quotaBase, 300);
  assert.equal(validateSendPlan(plan), null);

  const before = planInEffect(plan, "2026-11-15");
  assert.equal(before.mode, "per_meal");
  const tonight = slotsFromPlan(before, settings);
  assert.deepEqual(tonight.map((slot) => slot.id), ["breakfast", "lunch", "dinner", "late"]);
  assert.equal(tonight.every((slot) => !slot.combined), true);

  const after = planInEffect(plan, "2026-11-16");
  assert.equal(after.mode, "daily");
  const morning = slotsFromPlan(after, settings);
  assert.equal(morning.length, 1);
  assert.equal(morning[0].id, "daily");
  assert.equal(morning[0].time, "07:00");
  assert.equal(morning[0].combined, true);
  assert.deepEqual(morning[0].meals, ["breakfast", "lunch", "dinner", "late"]);
  assert.equal(pushesPerDay(after, settings), 1);
  assert.equal(pushesPerDay(before, settings), 4);
});

test("twice and per-meal modes build the right slots", () => {
  const twice = normalizeSendPlan({
    mode: "twice",
    firstMeals: ["breakfast", "lunch"],
    firstTime: "07:00",
    secondMeals: ["dinner", "late"],
    secondTime: "16:30",
    effectiveFrom: "2026-11-16",
  });
  assert.equal(validateSendPlan(twice), null);
  const slots = slotsFromPlan(twice);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[0].meals, ["breakfast", "lunch"]);
  assert.equal(slots[0].combined, true);
  assert.deepEqual(slots[1].meals, ["dinner", "late"]);
  assert.equal(pushesPerDay(twice), 2);

  const overlap = normalizeSendPlan({
    ...twice,
    secondMeals: ["lunch", "dinner"],
  });
  assert.match(validateSendPlan(overlap) || "", /ซ้ำ/);

  const perMeal = planInEffect({ ...defaultSendPlan(), mode: "per_meal", effectiveFrom: "2026-11-01" }, "2026-11-16");
  const offLunch = settings.map((item) => (item.meal === "lunch" ? { ...item, enabled: false } : item));
  assert.equal(pushesPerDay(perMeal, offLunch), 3);
});

test("combined auto-send is not skipped just because a meal was asked", () => {
  assert.equal(
    skipReasonForSlot({ combined: true, askedMeals: ["breakfast"], logs: [] }),
    null,
  );
  assert.equal(
    skipReasonForSlot({
      combined: true,
      askedMeals: ["breakfast"],
      logs: [{ meal: "breakfast", status: "sent", detail: "ส่งรวมทั้งวัน" }],
    }),
    "ส่งรอบนี้ไปแล้ววันนี้",
  );
  assert.equal(
    skipReasonForSlot({
      combined: false,
      askedMeals: ["dinner"],
      logs: [],
    }),
    "กลุ่มนี้ถามเมนูไปแล้ว",
  );
});

test("quota calculator uses members, month length, usage, and run-out date", () => {
  // 1 push/day × 6 members × 30 days = 180, under 300, with 66 already used in mid-November.
  const daily = projectQuota({
    pushesPerDay: 1,
    memberCount: 6,
    year: 2026,
    month: 11,
    todayDay: 15,
    used: 66,
    quotaBase: 300,
    remainingSlotsToday: 0,
  });
  assert.equal(daily.dailyUse, 6);
  assert.equal(daily.monthIfChosen, 180);
  assert.equal(daily.remaining, 234);
  assert.equal(daily.upcoming, 15 * 6);
  assert.equal(daily.projectedEnd, 66 + 90);
  assert.equal(daily.overMonth, false);
  assert.equal(daily.overProjected, false);
  assert.equal(daily.runOutDate, null);

  // 4 pushes/day × 6 × 30 = 720, already 66 used on 15 Nov, remaining tonight = 2 (dinner+late).
  const four = projectQuota({
    pushesPerDay: 4,
    memberCount: 6,
    year: 2026,
    month: 11,
    todayDay: 15,
    used: 66,
    quotaBase: 300,
    remainingSlotsToday: 2,
  });
  assert.equal(four.monthIfChosen, 720);
  assert.equal(four.overMonth, true);
  assert.equal(four.overProjected, true);
  assert.equal(four.upcoming, 2 * 6 + 15 * 24);
  assert.equal(four.projectedEnd, 66 + 12 + 360);
  assert.equal(four.runOutDate, "2026-11-25");

  const todayBurst = projectQuota({
    pushesPerDay: 4,
    memberCount: 6,
    year: 2026,
    month: 11,
    todayDay: 15,
    used: 290,
    quotaBase: 300,
    remainingSlotsToday: 2,
  });
  assert.equal(todayBurst.runOutDate, "2026-11-15");
});

test("07:00 window and remaining slots for cron decisions", () => {
  const before = bangkokNow(new Date("2026-11-16T00:00:00Z")); // 07:00 BKK
  const during = bangkokNow(new Date("2026-11-16T00:05:00Z")); // 07:05
  const after = bangkokNow(new Date("2026-11-16T00:10:00Z")); // 07:10
  assert.equal(sendWindow(before, "07:00"), true);
  assert.equal(sendWindow(during, "07:00"), true);
  assert.equal(sendWindow(after, "07:00"), false);

  const slots = slotsFromPlan(defaultSendPlan());
  assert.equal(remainingSlotsToday({ slots, now: before }), 1);
  assert.equal(remainingSlotsToday({ slots, now: during }), 1);
  assert.equal(remainingSlotsToday({ slots, now: after }), 0);
  assert.equal(remainingSlotsToday({ slots, now: during, alreadySentIds: ["daily"] }), 0);

  const next = nextSlot({ now: before, slots, sentIds: [] });
  assert.equal(next?.date, "2026-11-16");
  assert.equal(next?.slot.id, "daily");
  assert.equal(next?.due, true);

  const later = bangkokNow(new Date("2026-11-16T04:00:00Z")); // 11:00 BKK, window gone
  const tomorrow = nextSlot({ now: later, slots, sentIds: [] });
  assert.equal(tomorrow?.date, "2026-11-17");
  assert.equal(tomorrow?.due, false);
});

test("combined flex is one carousel with one bubble per meal", () => {
  const flex = buildMenuFlex({
    date: "2026-11-16",
    meals: [
      { meal: "breakfast", dishText: "โจ๊กหมู" },
      { meal: "lunch", dishText: "ผัดไทย" },
      { meal: "dinner", dishText: "ต้มจืดมะระยัดไส้ไก่" },
      { meal: "late", dishText: "ก๋วยเตี๋ยวน้ำ" },
    ],
  });
  assert.equal(flex.type, "flex");
  assert.equal((flex.contents as { type: string }).type, "carousel");
  const bubbles = (flex.contents as { contents: unknown[] }).contents;
  assert.equal(bubbles.length, 4);
  assert.equal((bubbles[0] as { type: string }).type, "bubble");
  assert.match(flex.altText, /โจ๊กหมู/);
  assert.match(flex.altText, /ผัดไทย/);
  const dinner = bubbles[2] as { body?: { contents?: Array<Record<string, unknown>> } };
  const dish = dinner.body?.contents?.find((item) => item.text === "ต้มจืดมะระยัดไส้ไก่");
  assert.ok(dish);
  assert.equal(dish.size, "xl");
  const single = buildMenuFlex({ date: "2026-11-16", meals: [{ meal: "lunch", dishText: "ผัดไทย" }] });
  assert.equal((single.contents as { type: string }).type, "bubble");
  assert.equal(single.contents.type || buildFlexMessage({ date: "2026-11-16", meal: "lunch", dishText: "ผัดไทย" }).contents.type, "bubble");
});
