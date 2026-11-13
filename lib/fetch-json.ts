// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/** fetch + JSON that never throws: network errors and non-JSON responses become { ok: false, body.error }. */
export async function fetchJson(input: string, init?: RequestInit): Promise<{ response: { ok: boolean; status: number }; body: Json }> {
  try {
    const res = await fetch(input, init);
    const body = await res.json().catch(() => ({
      ok: false,
      error: res.status === 413 ? "ไฟล์ใหญ่เกินไป" : res.status >= 500 ? "เซิร์ฟเวอร์ตอบช้าหรือขัดข้อง ลองใหม่อีกครั้ง" : "อ่านข้อมูลไม่สำเร็จ",
    }));
    return { response: { ok: res.ok, status: res.status }, body };
  } catch {
    return { response: { ok: false, status: 0 }, body: { ok: false, error: "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่" } };
  }
}
