import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  applyBotPresence,
  bangkokDayOfYear,
  fallbackSendBot,
  pickSendBot,
  preferredBotForDate,
  shouldAnswerQuestion,
  signatureMatches,
} from "@/lib/line-bots";

test("daily alternation uses Bangkok day-of-year parity", () => {
  assert.equal(bangkokDayOfYear("2026-11-15"), 319);
  assert.equal(preferredBotForDate("2026-11-15"), "1"); // odd, existing bot
  assert.equal(preferredBotForDate("2026-11-16"), "2");
  assert.equal(bangkokDayOfYear("2028-03-01"), 61);
  assert.equal(preferredBotForDate("2028-03-01"), "1");
});

test("send bot falls back when the preferred bot is missing or not in the group", () => {
  const even = "2026-11-16"; // prefers 2
  const odd = "2026-11-15"; // prefers 1

  // No-op: bot 2 is not configured, always bot 1.
  assert.equal(pickSendBot({ date: even, bot1Configured: true, bot2Configured: false, botsInGroup: ["1"] }), "1");
  assert.equal(pickSendBot({ date: odd, bot1Configured: true, bot2Configured: false, botsInGroup: ["1"] }), "1");

  // Both configured and in the group: follow the calendar.
  assert.equal(pickSendBot({ date: even, bot1Configured: true, bot2Configured: true, botsInGroup: ["1", "2"] }), "2");
  assert.equal(pickSendBot({ date: odd, bot1Configured: true, bot2Configured: true, botsInGroup: ["1", "2"] }), "1");

  // Only one bot in the group, always use that bot.
  assert.equal(pickSendBot({ date: even, bot1Configured: true, bot2Configured: true, botsInGroup: ["1"] }), "1");
  assert.equal(pickSendBot({ date: odd, bot1Configured: true, bot2Configured: true, botsInGroup: ["2"] }), "2");

  // Preferred bot fails: fall back to the other member.
  assert.equal(
    fallbackSendBot({ date: even, bot1Configured: true, bot2Configured: true, botsInGroup: ["1", "2"] }, "2"),
    "1",
  );
  assert.equal(
    fallbackSendBot({ date: even, bot1Configured: true, bot2Configured: true, botsInGroup: ["2"] }, "2"),
    null,
  );
  assert.equal(pickSendBot({ date: even, bot1Configured: false, bot2Configured: false }), null);
});

test("only today's sending bot answers a group question", () => {
  const even = {
    date: "2026-11-16",
    bot1Configured: true,
    bot2Configured: true,
    botsInGroup: ["1", "2"] as ("1" | "2")[],
  };
  assert.equal(shouldAnswerQuestion({ ...even, receivingBot: "2", isGroup: true }), true);
  assert.equal(shouldAnswerQuestion({ ...even, receivingBot: "1", isGroup: true }), false);
  // 1:1 chats are received by only one OA, so that bot always answers.
  assert.equal(shouldAnswerQuestion({ ...even, receivingBot: "1", isGroup: false }), true);
  // If bot 2 is not configured, bot 1 still answers on an even day.
  assert.equal(
    shouldAnswerQuestion({
      date: even.date,
      bot1Configured: true,
      bot2Configured: false,
      botsInGroup: ["1"],
      receivingBot: "1",
      isGroup: true,
    }),
    true,
  );
});

test("a leave event drops only that bot from the group", () => {
  const both = { bot1: true, bot2: true, active: true };
  assert.deepEqual(applyBotPresence(both, "2", "leave"), { bot1: true, bot2: false, active: true });
  assert.deepEqual(applyBotPresence({ bot1: true, bot2: false, active: true }, "1", "leave"), {
    bot1: false,
    bot2: false,
    active: false,
  });
  assert.deepEqual(applyBotPresence({ bot1: true, bot2: false, active: true }, "2", "seen"), {
    bot1: true,
    bot2: true,
    active: true,
  });
});

test("webhook signatures are verified per bot secret", () => {
  const body = '{"events":[]}';
  const secret1 = "channel-secret-one";
  const secret2 = "channel-secret-two";
  const sig1 = crypto.createHmac("sha256", secret1).update(body).digest("base64");
  const sig2 = crypto.createHmac("sha256", secret2).update(body).digest("base64");
  assert.equal(signatureMatches(body, sig1, secret1), true);
  assert.equal(signatureMatches(body, sig2, secret2), true);
  assert.equal(signatureMatches(body, sig1, secret2), false);
  assert.equal(signatureMatches(body, sig2, secret1), false);
  assert.equal(signatureMatches(body, null, secret1), false);
  assert.equal(signatureMatches(body, sig1, ""), false);
});
