import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDictionary, correctCells, correctDishText, dishWords, mergeReadings, thaiFixDistance } from "../lib/dish-correct";
import type { DraftCell } from "../lib/parse-menu";

const dictionary = buildDictionary([
  "ผัดซีอิ๊วไก่บด",
  "ผักกาดดองผัดไข่",
  "ต้มจืดผักกาดดองหมู ยำไก่แซ่บ",
  "ข้าวต้มกุ๊ย+ไก่กระเทียม",
  "แกงเลี้ยงผักรวม",
  "ยำไก่ยอ",
  "กระเพราไก่ไส้กรอกแดง",
]);

const cell = (day: number, dishText: string, extra: Partial<DraftCell> = {}): DraftCell => ({
  day,
  meal: "lunch",
  dishText,
  needsReview: false,
  ...extra,
});

test("splits a cell into dish words", () => {
  assert.deepEqual(dishWords("ยำไก่แซ่บ  ต้มจืดผักกาดดองหมู"), ["ยำไก่แซ่บ", "ต้มจืดผักกาดดองหมู"]);
  assert.deepEqual(dishWords("ข้าวต้มกุ๊ย+ไก่กระเทียม"), ["ข้าวต้มกุ๊ย", "ไก่กระเทียม"]);
});

test("fixes tone marks and look-alike letters to a known spelling", () => {
  assert.equal(correctDishText("ผัดซีอิ้วไก่บด", dictionary), "ผัดซีอิ๊วไก่บด");
  assert.equal(correctDishText("ผัดกาดดองผัดไข่", dictionary), "ผักกาดดองผัดไข่");
  assert.equal(correctDishText("แกงเลียงผักรวม", dictionary), "แกงเลี้ยงผักรวม");
  assert.equal(correctDishText("กระเพราไก่ใส้กรอกแดง", dictionary), "กระเพราไก่ไส้กรอกแดง");
  assert.equal(correctDishText("ข้าวต้มกุ้ย+ไก่กระเทียม", dictionary), "ข้าวต้มกุ๊ย+ไก่กระเทียม");
});

test("never swaps in a different dish", () => {
  // ไข่ (egg) vs ไก่ (chicken) is a different dish, not a spelling slip.
  assert.equal(correctDishText("ยำไข่ยอ", dictionary), "ยำไข่ยอ");
  assert.equal(correctDishText("ข้าวต้มกุ้ง+ไก่กระเทียม", dictionary), "ข้าวต้มกุ้ง+ไก่กระเทียม");
  assert.equal(correctDishText("ต้มซุปเปอร์ไก่", dictionary), "ต้มซุปเปอร์ไก่");
  assert.ok(thaiFixDistance("ไก่", "ไข่") > 1);
});

test("keeps the original text so the fix can be undone", () => {
  const [fixed, untouched] = correctCells([cell(1, "ผัดซีอิ้วไก่บด"), cell(2, "ยำไก่ยอ")], dictionary);
  assert.equal(fixed.dishText, "ผัดซีอิ๊วไก่บด");
  assert.equal(fixed.originalText, "ผัดซีอิ้วไก่บด");
  assert.equal(untouched.originalText, undefined);
});

test("double read: agreement passes, disagreement is flagged and prefers known dishes", () => {
  const first = [cell(1, "ยำไก่ยอ"), cell(2, "ยำไข่เยี่ยวม้า"), cell(3, "ข้าวมันไก่")];
  const second = [cell(1, "ยำไก่ยอ"), cell(2, "ยำไก่แซ่บ"), cell(3, "")];
  const merged = mergeReadings(first, second, dictionary);
  assert.equal(merged[0].needsReview, false);
  assert.equal(merged[0].altText, undefined);
  assert.equal(merged[1].dishText, "ยำไก่แซ่บ");
  assert.equal(merged[1].altText, "ยำไข่เยี่ยวม้า");
  assert.equal(merged[1].needsReview, true);
  assert.equal(merged[2].dishText, "ข้าวมันไก่");
  assert.equal(merged[2].needsReview, true);
  assert.deepEqual(mergeReadings(first, null, dictionary), first);
});
