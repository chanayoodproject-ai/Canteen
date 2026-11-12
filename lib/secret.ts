export function cronSecret() {
  return process.env.CRON_SECRET || (process.env.NODE_ENV === "production" ? "" : "dev-cron-secret");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
