import crypto from "crypto";

/** Pure helpers for the two LINE Official Accounts. Easy to test; no server imports. */

export type BotId = "1" | "2";

export const BOT_IDS: BotId[] = ["1", "2"];

export const LINE_BOT_SECRET_KEYS = {
  "1": {
    token: "LINE_CHANNEL_ACCESS_TOKEN",
    secret: "LINE_CHANNEL_SECRET",
  },
  "2": {
    token: "LINE_CHANNEL_ACCESS_TOKEN_2",
    secret: "LINE_CHANNEL_SECRET_2",
  },
} as const;

/** Day of year in the Bangkok calendar date (1–366). */
export function bangkokDayOfYear(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, month - 1, day);
  return Math.floor((current - start) / 86_400_000) + 1;
}

/**
 * Deterministic daily rotation: odd Bangkok day-of-year → bot 1, even → bot 2.
 * 15 Nov 2026 is day 319 (odd), so today's auto-send stays on the existing bot
 * until bot 2 is configured and in the group.
 */
export function preferredBotForDate(iso: string): BotId {
  return bangkokDayOfYear(iso) % 2 === 1 ? "1" : "2";
}

export function otherBot(bot: BotId): BotId {
  return bot === "1" ? "2" : "1";
}

export function botsFromFlags(bot1: boolean, bot2: boolean): BotId[] {
  const bots: BotId[] = [];
  if (bot1) bots.push("1");
  if (bot2) bots.push("2");
  return bots;
}

export type BotPresence = { bot1: boolean; bot2: boolean; active: boolean };

/** Join/message marks that bot present; leave clears only that bot and keeps the group active if the other remains. */
export function applyBotPresence(current: BotPresence, bot: BotId, event: "seen" | "leave"): BotPresence {
  const next = { bot1: current.bot1, bot2: current.bot2 };
  if (event === "leave") {
    if (bot === "1") next.bot1 = false;
    else next.bot2 = false;
  } else if (bot === "1") next.bot1 = true;
  else next.bot2 = true;
  return { ...next, active: next.bot1 || next.bot2 };
}

export type PickSendBotInput = {
  date: string;
  bot1Configured: boolean;
  bot2Configured: boolean;
  /** Bots known to be members of this group. Empty/unknown defaults to bot 1 only (legacy groups). */
  botsInGroup?: BotId[];
};

function configuredBots(input: PickSendBotInput): BotId[] {
  const bots: BotId[] = [];
  if (input.bot1Configured) bots.push("1");
  if (input.bot2Configured) bots.push("2");
  return bots;
}

function membersInGroup(input: PickSendBotInput): BotId[] {
  const members = input.botsInGroup;
  if (!members || members.length === 0) return ["1"];
  return members;
}

/**
 * Which bot should auto-send (or answer a group question) for this date and group.
 * Falls back when the preferred bot is not configured or not in the group.
 * Returns null only when no configured bot can send.
 */
export function pickSendBot(input: PickSendBotInput): BotId | null {
  const configured = configuredBots(input);
  if (configured.length === 0) return null;
  const members = membersInGroup(input);
  const available = configured.filter((bot) => members.includes(bot));
  const pool = available.length ? available : configured;
  const preferred = preferredBotForDate(input.date);
  if (pool.includes(preferred)) return preferred;
  return pool[0] ?? null;
}

/** Fallback candidate when the chosen bot's push fails. */
export function fallbackSendBot(input: PickSendBotInput, attempted: BotId): BotId | null {
  const next = otherBot(attempted);
  const configured = configuredBots(input);
  const members = membersInGroup(input);
  if (!configured.includes(next)) return null;
  if (members.length && !members.includes(next)) return null;
  return next;
}

/**
 * In a group, only today's sending bot answers, so the two webhooks do not both reply.
 * A 1:1 chat is received by only one OA, so that bot always answers.
 */
export function shouldAnswerQuestion(
  input: PickSendBotInput & { receivingBot: BotId; isGroup: boolean },
): boolean {
  if (!input.isGroup) return true;
  return pickSendBot(input) === input.receivingBot;
}


/** LINE webhook HMAC-SHA256 (base64), compared in constant time. */
export function signatureMatches(body: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const digest = crypto.createHmac("sha256", secret).update(body).digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
