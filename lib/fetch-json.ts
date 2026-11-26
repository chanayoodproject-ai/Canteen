// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const RETRY_DELAYS_MS = [500, 1000];

/** fetch + JSON that never throws: network errors and non-JSON responses become { ok: false, body.error }. */
export async function fetchJson(input: string, init?: RequestInit): Promise<{ response: { ok: boolean; status: number }; body: Json }> {
  const method = (init?.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  const maxAttempts = canRetry ? 1 + RETRY_DELAYS_MS.length : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(input, init);
      if (canRetry && res.status >= 500 && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      const body = await res.json().catch(() => ({
        ok: false,
        error: res.status === 413 ? "ไฟล์ใหญ่เกินไป" : res.status >= 500 ? "เซิร์ฟเวอร์ตอบช้าหรือขัดข้อง ลองใหม่อีกครั้ง" : "อ่านข้อมูลไม่สำเร็จ",
      }));
      return { response: { ok: res.ok, status: res.status }, body };
    } catch {
      if (canRetry && attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return { response: { ok: false, status: 0 }, body: { ok: false, error: "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่" } };
    }
  }
  return { response: { ok: false, status: 0 }, body: { ok: false, error: "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่" } };
}
