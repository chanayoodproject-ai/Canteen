"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MEAL_MAP, type MealKey } from "@/lib/meals";
import { formatThaiDateShort } from "@/lib/time";

type SendSetting = { meal: MealKey; sendTime: string; enabled: boolean };
type Log = { id: string; menuDate: string; meal: MealKey; status: string; detail: string | null; createdAt: string };

export default function SchedulePage() {
  const [settings, setSettings] = useState<SendSetting[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const { response, body } = await fetchJson("/api/schedule", { cache: "no-store" });
    if (!response.ok) {
      setError(body.error || "โหลดเวลาส่งไม่สำเร็จ");
      return;
    }
    setSettings(body.settings);
    setLogs(body.logs);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function patch(meal: MealKey, next: Partial<SendSetting>) {
    setSettings((current) => current.map((item) => (item.meal === meal ? { ...item, ...next } : item)));
  }

  async function save() {
    setSaving(true);
    const { response, body } = await fetchJson("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    setSaving(false);
    if (!response.ok) {
      toast.error(body.error || "บันทึกไม่สำเร็จ");
      return;
    }
    toast.success("บันทึกเวลาส่งแล้ว");
  }

  async function send(meal: MealKey, mode: "now" | "test") {
    const { response, body } = await fetchJson("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal, mode }),
    });
    if (!response.ok) {
      toast.error(body.error || "ส่งไม่สำเร็จ");
      return;
    }
    toast.success(body.results?.[0]?.detail || "ดำเนินการแล้ว");
    await load();
  }

  if (error) return <p>{error}</p>;
  if (!settings.length) return <div className="h-64 animate-pulse rounded-[2rem] bg-white/70" />;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#8A5A00]">เขตเวลา Asia/Bangkok</p>
        <h1 className="text-3xl font-bold">เวลาส่งทั้ง 4 มื้อ</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          ตั้งเวลาและเปิดปิดได้ทุกเมื่อ ค่าเริ่มต้นคือเช้า 06:30 เที่ยง 10:30 เย็น 15:30 ดึก 19:30 ตัวตั้งเวลาฟรีจะยิงมาบ่อย ๆ แล้วระบบส่งเฉพาะมื้อที่ถึงเวลาและยังไม่เคยส่งในวันนั้น
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {settings.map((setting) => {
          const meta = MEAL_MAP[setting.meal];
          return (
            <article key={setting.meal} className="rounded-[1.6rem] bg-white p-4" style={{ boxShadow: `inset 6px 0 0 ${meta.accent}` }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">{meta.full}</h2>
                  <p className="text-sm text-[#6B5348]">{meta.hint}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span>{setting.enabled ? "เปิดส่ง" : "ปิดอยู่"}</span>
                  <Switch checked={setting.enabled} onCheckedChange={(checked) => patch(setting.meal, { enabled: checked })} />
                </label>
              </div>
              <label className="mt-4 block text-sm font-semibold" htmlFor={`time-${setting.meal}`}>
                เวลาส่ง
                <input
                  id={`time-${setting.meal}`}
                  type="time"
                  value={setting.sendTime}
                  onChange={(event) => patch(setting.meal, { sendTime: event.target.value })}
                  className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3 text-lg"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void send(setting.meal, "test")}>ส่งทดสอบ</Button>
                <Button size="sm" onClick={() => void send(setting.meal, "now")}>ส่งมื้อนี้ตอนนี้</Button>
              </div>
            </article>
          );
        })}
      </div>
      <Button size="lg" onClick={() => void save()} disabled={saving}>{saving ? "กำลังบันทึก..." : "บันทึกเวลาส่ง"}</Button>
      <section className="rounded-[1.6rem] bg-white p-4">
        <h2 className="text-lg font-bold">บันทึกการส่ง</h2>
        {logs.length === 0 ? (
          <p className="mt-2 text-sm text-[#6B5348]">ยังไม่มีรายการ</p>
        ) : (
          <>
          <ul className="mt-3 space-y-3 md:hidden">
            {logs.map((log) => (
              <li key={log.id} className="rounded-2xl bg-[#F7FFF4] p-3 text-sm">
                <p className="font-semibold">{formatThaiDateShort(log.menuDate)} · {MEAL_MAP[log.meal].full}</p>
                <p className="mt-1">{statusText(log.status)}</p>
                <p className="mt-1 text-[#6B5348]">{log.detail}</p>
              </li>
            ))}
          </ul>
          <div className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[#8C7264]">
                <tr>
                  <th className="py-2 font-medium">วัน</th>
                  <th className="font-medium">มื้อ</th>
                  <th className="font-medium">สถานะ</th>
                  <th className="font-medium">รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-[#F3E7DC]">
                    <td className="py-2">{formatThaiDateShort(log.menuDate)}</td>
                    <td>{MEAL_MAP[log.meal].label}</td>
                    <td>{statusText(log.status)}</td>
                    <td className="text-[#6B5348]">{log.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}

function statusText(status: string) {
  if (status === "sent") return "ส่งแล้ว";
  if (status === "simulated") return "จำลอง";
  if (status === "failed") return "ไม่สำเร็จ";
  if (status === "test") return "ทดสอบ";
  if (status === "claimed") return "กำลังส่ง";
  return status;
}
