import { MEAL_KEYS } from "@/lib/meals";
import type { DraftCell } from "@/lib/parse-menu";

/**
 * Spelling clean-up for menu text read from photos.
 *
 * Only tone marks, vowel marks and a few look-alike letters may change, so a word is fixed to a known
 * spelling of the same dish and never swapped for a different dish (ไก่ ↔ ไข่ and similar are never touched).
 */

export type OcrCell = DraftCell;

/** Common misspellings in canteen menus. Applied before the dictionary. */
export const BUILTIN_FIXES: [RegExp, string][] = [
  [/ซีอิ้ว|ซีอิ๋ว|ซีอิ่ว/g, "ซีอิ๊ว"],
  [/โป้ว|โป่ว/g, "โป๊ว"],
  [/ผัดกาด(?=ดอง|ขาว|เขียว|หอม)/g, "ผักกาด"],
  [/พะเขือ/g, "มะเขือ"],
  [/กุ้ย(?=\+|\s|$)/g, "กุ๊ย"],
];

const TONE = new Set(["\u0E48", "\u0E49", "\u0E4A", "\u0E4B", "\u0E4C", "\u0E47"]);
const VOWEL_MARK = new Set(["\u0E31", "\u0E34", "\u0E35", "\u0E36", "\u0E37", "\u0E38", "\u0E39", "\u0E4D"]);
// Look-alike letters a camera often confuses. Pairs that change the dish (ก/ข = chicken/egg) are left out on purpose.
const LOOK_ALIKE = new Set(
  ["กด", "มพ", "ดต", "บป", "ถภ", "ผฝ", "พฟ", "ใไ", "ฎฏ", "ซช", "ฅค"].flatMap(([a, b]) => [a + b, b + a]),
);

const TONE_COST = 0.3;
const VOWEL_COST = 0.5;
const LOOK_ALIKE_COST = 0.6;
const BLOCKED = 99;
/** Total edit budget for one word. Two tone fixes, or one look-alike letter plus one tone mark, at most. */
export const MAX_FIX_COST = 0.9;

function substitutionCost(a: string, b: string) {
  if (a === b) return 0;
  if (TONE.has(a) && TONE.has(b)) return TONE_COST;
  if (VOWEL_MARK.has(a) && VOWEL_MARK.has(b)) return VOWEL_COST;
  if (LOOK_ALIKE.has(a + b)) return LOOK_ALIKE_COST;
  return BLOCKED;
}

function indelCost(char: string) {
  if (TONE.has(char)) return TONE_COST;
  if (VOWEL_MARK.has(char)) return VOWEL_COST;
  return BLOCKED;
}

/** Weighted edit distance that only allows Thai mark / look-alike edits; returns ≥ BLOCKED otherwise. */
export function thaiFixDistance(source: string, target: string, limit = MAX_FIX_COST) {
  const a = [...source];
  const b = [...target];
  if (Math.abs(a.length - b.length) > 2) return BLOCKED;
  let previous = new Array<number>(b.length + 1);
  previous[0] = 0;
  for (let j = 1; j <= b.length; j += 1) previous[j] = previous[j - 1] + indelCost(b[j - 1]);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1);
    current[0] = previous[0] + indelCost(a[i - 1]);
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j - 1] + substitutionCost(a[i - 1], b[j - 1]),
        previous[j] + indelCost(a[i - 1]),
        current[j - 1] + indelCost(b[j - 1]),
      );
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > limit) return BLOCKED;
    previous = current;
  }
  return previous[b.length];
}

const WORD_SPLIT = /(\s+|\+|,|\/)/;

/** Split a menu cell into dish words: "ต้มยำขาหมู ยำไข่ดาว" → ["ต้มยำขาหมู", "ยำไข่ดาว"]. */
export function dishWords(text: string) {
  return text
    .split(WORD_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !WORD_SPLIT.test(part) && /[\u0E00-\u0E7F]/.test(part));
}

export type DishDictionary = { words: Set<string>; byLength: Map<number, string[]> };

export function buildDictionary(texts: Iterable<string>): DishDictionary {
  const words = new Set<string>();
  for (const text of texts) for (const word of dishWords(String(text || ""))) words.add(word);
  const byLength = new Map<number, string[]>();
  for (const word of words) {
    const length = [...word].length;
    byLength.set(length, [...(byLength.get(length) ?? []), word]);
  }
  return { words, byLength };
}

function closestKnown(word: string, dictionary: DishDictionary) {
  if (dictionary.words.has(word)) return word;
  const length = [...word].length;
  let best = "";
  let bestCost = BLOCKED;
  let tie = false;
  for (let delta = -2; delta <= 2; delta += 1) {
    for (const candidate of dictionary.byLength.get(length + delta) ?? []) {
      const cost = thaiFixDistance(word, candidate);
      if (cost < bestCost - 1e-9) {
        best = candidate;
        bestCost = cost;
        tie = false;
      } else if (Math.abs(cost - bestCost) < 1e-9 && candidate !== best) tie = true;
    }
  }
  // Ambiguous matches are left alone so a word is never forced into the wrong dish.
  return bestCost <= MAX_FIX_COST && !tie ? best : word;
}

/** Fix the spelling of one cell. Returns the same text when nothing safe to fix. */
export function correctDishText(text: string, dictionary: DishDictionary) {
  let fixed = text;
  for (const [pattern, replacement] of BUILTIN_FIXES) fixed = fixed.replace(pattern, replacement);
  fixed = fixed
    .split(WORD_SPLIT)
    .map((part) => (part.length >= 3 && !WORD_SPLIT.test(part) ? closestKnown(part, dictionary) : part))
    .join("");
  return fixed;
}

/** Share of words in a cell that are already known dishes (0..1). */
export function knownShare(text: string, dictionary: DishDictionary) {
  const words = dishWords(text);
  if (!words.length) return 0;
  return words.filter((word) => dictionary.words.has(word)).length / words.length;
}

const squash = (value: string) => value.replace(/\s+/g, "");

/** Spellings that mean the same dish (official vs common). Two readings that differ only by these agree. */
const SAME_DISH_VARIANTS: [RegExp, string][] = [
  [/กระเพรา|กะเพรา|กระเพา/g, "กะเพรา"],
  [/กระหล่ำ|กะหล่ำ/g, "กะหล่ำ"],
  [/กระหรี่|กะหรี่/g, "กะหรี่"],
  [/ฮอตดอก|ฮอทดอก/g, "ฮอตดอก"],
  [/เกี๊ยว|เกี๋ยว|เกี้ยว/g, "เกี๊ยว"],
];

function sameDish(a: string, b: string) {
  const norm = (value: string) => SAME_DISH_VARIANTS.reduce((text, [pattern, to]) => text.replace(pattern, to), squash(value));
  return norm(a) === norm(b);
}

/** Apply spelling fixes, keeping the original text so the review table can show and undo it. */
export function correctCells(cells: OcrCell[], dictionary: DishDictionary): OcrCell[] {
  return cells.map((cell) => {
    if (!cell.dishText) return cell;
    const fixed = correctDishText(cell.dishText, dictionary);
    if (squash(fixed) === squash(cell.dishText)) return cell;
    return { ...cell, dishText: fixed, originalText: cell.originalText ?? cell.dishText };
  });
}

/**
 * Merge two independent readings of the same photo (already spelling-corrected).
 * Cells where they agree are kept; where they disagree the one that matches known dishes wins
 * (first reading on a tie) and the cell is flagged for review with the other reading attached.
 */
export function mergeReadings(first: OcrCell[], second: OcrCell[] | null, dictionary: DishDictionary): OcrCell[] {
  if (!second) return first;
  const key = (cell: OcrCell) => `${cell.day}:${cell.meal}`;
  const a = new Map(first.map((cell) => [key(cell), cell]));
  const b = new Map(second.map((cell) => [key(cell), cell]));
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  const merged: OcrCell[] = [];
  for (const id of keys) {
    const one = a.get(id);
    const two = b.get(id);
    if (!one || !two) {
      const only = (one ?? two)!;
      if (!only.dishText) continue;
      merged.push({ ...only, needsReview: true, altText: "" });
      continue;
    }
    if (sameDish(one.dishText, two.dishText)) {
      merged.push({ ...one, needsReview: one.needsReview || two.needsReview });
      continue;
    }
    if (!one.dishText || !two.dishText) {
      const filled = one.dishText ? one : two;
      merged.push({ ...filled, needsReview: true, altText: "" });
      continue;
    }
    const pickSecond = knownShare(two.dishText, dictionary) > knownShare(one.dishText, dictionary);
    const chosen = pickSecond ? two : one;
    const other = pickSecond ? one : two;
    merged.push({ ...chosen, needsReview: true, altText: other.dishText });
  }
  return merged.sort((x, y) => x.day - y.day || MEAL_KEYS.indexOf(x.meal) - MEAL_KEYS.indexOf(y.meal));
}
