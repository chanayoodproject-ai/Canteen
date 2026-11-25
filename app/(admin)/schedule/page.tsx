"use client";

import { fetchJson } from "@/lib/fetch-json";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MEAL_KEYS, MEAL_MAP, type MealKey } from "@/lib/meals";
import {
  defaultSendPlan,
  planInEffect,
  projectQuota,
  remainingSlotsToday,
  slotsFromPlan,
  type SendPlan,
  type SendPlanMode,
} from "@/lib/send-plan";
import { formatThaiDateShort } from "@/lib/time";

type BotId = "1" | "2";
type BotSummary = { id: BotId; configured: boolean; enabled: boolean };
type SendSetting = { meal: MealKey; sendTime: string; enabled: boolean };
type Log = { id: string; menuDate: string; meal: MealKey; status: string; detail: string | null; createdAt: string; bot?: BotId | null };
type Clock = { year: number; month: number; day: number; hour: number; minute: number; iso: string };

const MODES: { id: SendPlanMode; title: string; desc: string }[] = [
  { id: "daily", title: "วันละครั้ง รวมทุกมื้อ", desc: "ส่งการ์ดรวม 4 มื้อในครั้งเดียว ตามเวลาที่เลือก" },
  { id: "twice", title: "วันละ 2 ครั้ง", desc: "เลือกว่ามื้อไหนอยู่ในรอบไหน และส่งคนละเวลา" },
  { id: "per_meal", title: "แยกตามมื้อ", desc: "ส่งทีละมื้อ ตามเวลาของมื้อนั้น" },
];

export default function SchedulePage() {
  const [activeBot, setActiveBot] = useState<BotId>("1");
  const [bots, setBots] = useState<BotSummary[]>([
    { id: "1", configured: true, enabled: true },
    { id: "2", configured: false, enabled: true },
  ]);
  const [settings, setSettings] = useState<SendSetting[]>([]);
  const [plan, setPlan] = useState<SendPlan>(defaultSendPlan());
  const [savedPlan, setSavedPlan] = useState<SendPlan | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [clock, setClock] = useState<Clock | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [groupCount, setGroupCount] = useState(0);
  const [memberSource, setMemberSource] = useState<"line" | "cache" | "fallback">("fallback");
  const [used, setUsed] = useState<number | null>(null);
  const [quotaLimit, setQuotaLimit] = useState<number | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (bot: BotId) => {
    const { response, body } = await fetchJson(`/api/schedule?bot=${bot}`, { cache: "no-store" });
    if (!response.ok) {
      setError(body.error || "โหลดเวลาส่งไม่สำเร็จ");
      return;
    }
    setError("");
    if (Array.isArray(body.bots)) setBots(body.bots);
    setSettings(body.settings);
    setPlan(body.plan);
    setSavedPlan(body.plan);
    setLogs(body.logs);
    setClock(body.clock);
    setMemberCount(body.quota?.memberCount ?? 0);
    setGroupCount(body.quota?.groupCount ?? 0);
    setMemberSource(body.quota?.memberSource ?? "fallback");
    setUsed(typeof body.quota?.used === "number" ? body.quota.used : null);
    setQuotaLimit(typeof body.quota?.limit === "number" ? body.quota.limit : null);
    setQuotaError(body.quota?.error ?? null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(activeBot), 0);
    return () => window.clearTimeout(timer);
  }, [activeBot, load]);

  function patchSetting(meal: MealKey, next: Partial<SendSetting>) {
    setSettings((current) => current.map((item) => (item.meal === meal ? { ...item, ...next } : item)));
  }

  function patchPlan(next: Partial<SendPlan>) {
    setPlan((current) => ({ ...current, ...next }));
  }

  function toggleTwiceMeal(round: "firstMeals" | "secondMeals", meal: MealKey) {
    setPlan((current) => {
      const has = current[round].includes(meal);
      const nextMeals = has ? current[round].filter((item) => item !== meal) : [...current[round], meal];
      const other = round === "firstMeals" ? "secondMeals" : "firstMeals";
      return {
        ...current,
        [round]: nextMeals,
        [other]: current[other].filter((item) => item !== meal || has),
      };
    });
  }

  const live = useMemo(() => {
    if (!clock) return null;
    const effective = planInEffect(plan, clock.iso);
    const slots = slotsFromPlan(plan, settings);
    const alreadySentIds = slots
      .filter((slot) =>
        slot.meals.some((meal) =>
          logs.some((log) => log.menuDate === clock.iso && log.meal === meal && (log.status === "sent" || log.status === "claimed")),
        ),
      )
      .map((slot) => slot.id);
    const remaining = remainingSlotsToday({ slots: slotsFromPlan(effective, settings), now: clock, alreadySentIds });
    const projection = projectQuota({
      pushesPerDay: slots.length,
      memberCount,
      year: clock.year,
      month: clock.month,
      todayDay: clock.day,
      used: used ?? 0,
      quotaBase: quotaLimit ?? plan.quotaBase,
      remainingSlotsToday: remaining,
    });
    return { effective, slots, projection };
  }, [plan, settings, clock, logs, memberCount, used, quotaLimit]);

  async function save() {
    setSaving(true);
    const { response, body } = await fetchJson("/api/schedule", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot: activeBot, settings, plan }),
    });
    setSaving(false);
    if (!response.ok) {
      toast.error(body.error || "บันทึกไม่สำเร็จ");
      return;
    }
    toast.success(`บันทึกตารางส่งบอท ${activeBot} แล้ว`);
    await load(activeBot);
  }

  async function send(meal: MealKey, mode: "now" | "test") {
    const { response, body } = await fetchJson("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meal, mode, bot: activeBot }),
    });
    if (!response.ok) {
      toast.error(body.error || "ส่งไม่สำเร็จ");
      return;
    }
    toast.success(body.results?.[0]?.detail || "ดำเนินการแล้ว");
    await load(activeBot);
  }

  if (error) return <p>{error}</p>;
  if (!settings.length || !clock) return <div className="h-64 animate-pulse rounded-[2rem] bg-white/70" />;

  const projection = live?.projection;
  const activeBotSummary = bots.find((b) => b.id === activeBot);
  const memberNote =
    groupCount === 0
      ? `ยังไม่มีกลุ่มของบอท ${activeBot}`
      : memberSource === "line"
        ? `นับจาก ${groupCount} กลุ่มของบอท ${activeBot} ใน LINE`
        : memberSource === "cache"
          ? `ใช้ตัวเลขที่แคชไว้ของบอท ${activeBot}`
          : "ยังนับจาก LINE ไม่ได้ จึงใช้ค่าสำรอง";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-[#8A5A00]">เขตเวลา Asia/Bangkok</p>
        <h1 className="text-3xl font-bold">เวลาส่งเมนู</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-[#6B5348]">
          เลือกตั้งเวลาส่ง คำนวณโควต้า และกดสั่งส่งแยกตามแต่ละบอทได้อิสระ
        </p>
      </div>

      <section className="grid grid-cols-2 gap-2 rounded-[1.6rem] bg-white p-2">
        {bots.map((item) => {
          const selected = activeBot === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveBot(item.id)}
              className={`rounded-2xl px-4 py-3 text-left transition ${
                selected ? "bg-[#2C1810] text-white" : "bg-[#FFF9F3] text-[#2C1810] hover:bg-[#FFF0E0]"
              }`}
            >
              <span className="block text-base font-bold">
                บอท {item.id} {item.id === "1" ? "(หลัก)" : "(ที่ 2)"}
              </span>
              <span className={`block text-xs ${selected ? "text-[#F6E2CF]" : "text-[#6B5348]"}`}>
                {!item.enabled ? "ปิดใช้งานชั่วคราว" : item.configured ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า"}
              </span>
            </button>
          );
        })}
      </section>

      {activeBotSummary && !activeBotSummary.configured && (
        <p className="rounded-2xl bg-[#FFF4D6] px-4 py-3 text-sm text-[#6B5348]">
          {!activeBotSummary.enabled
            ? `บอท ${activeBot} ถูกปิดใช้งานชั่วคราวไว้ (เปิดได้ที่หน้า LINE)`
            : `บอท ${activeBot} ยังไม่ได้ตั้งค่า Token/Secret (ตั้งค่าได้ที่หน้า LINE)`}
        </p>
      )}

      <section className="space-y-3">
        {MODES.map((mode) => (
          <label
            key={mode.id}
            className={`flex cursor-pointer items-start gap-3 rounded-[1.6rem] bg-white p-4 ${plan.mode === mode.id ? "ring-2 ring-[#E8772E]" : ""}`}
          >
            <input
              type="radio"
              name="send-mode"
              className="mt-1 h-5 w-5 accent-[#E8772E]"
              checked={plan.mode === mode.id}
              onChange={() => patchPlan({ mode: mode.id })}
            />
            <span>
              <span className="block text-lg font-bold">{mode.title}</span>
              <span className="mt-0.5 block text-sm text-[#6B5348]">{mode.desc}</span>
            </span>
          </label>
        ))}
      </section>

      {plan.mode === "daily" ? (
        <section className="rounded-[1.6rem] bg-white p-4">
          <label className="block text-sm font-semibold" htmlFor="daily-time">
            เวลาส่งทั้งวัน (บอท {activeBot})
            <input
              id="daily-time"
              type="time"
              value={plan.dailyTime}
              onChange={(event) => patchPlan({ dailyTime: event.target.value })}
              className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3 text-lg"
            />
          </label>
        </section>
      ) : null}

      {plan.mode === "twice" ? (
        <section className="grid gap-3">
          <TwiceCard
            title="รอบแรก"
            time={plan.firstTime}
            meals={plan.firstMeals}
            onTime={(value) => patchPlan({ firstTime: value })}
            onToggle={(meal) => toggleTwiceMeal("firstMeals", meal)}
          />
          <TwiceCard
            title="รอบหลัง"
            time={plan.secondTime}
            meals={plan.secondMeals}
            onTime={(value) => patchPlan({ secondTime: value })}
            onToggle={(meal) => toggleTwiceMeal("secondMeals", meal)}
          />
        </section>
      ) : null}

      {plan.mode === "per_meal" ? (
        <section className="grid gap-3">
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
                    <Switch checked={setting.enabled} onCheckedChange={(checked) => patchSetting(setting.meal, { enabled: checked })} />
                  </label>
                </div>
                <label className="mt-4 block text-sm font-semibold" htmlFor={`time-${setting.meal}`}>
                  เวลาส่ง
                  <input
                    id={`time-${setting.meal}`}
                    type="time"
                    value={setting.sendTime}
                    onChange={(event) => patchSetting(setting.meal, { sendTime: event.target.value })}
                    className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3 text-lg"
                  />
                </label>
              </article>
            );
          })}
        </section>
      ) : null}

      <section className="rounded-[1.6rem] bg-[#2C1810] p-4 text-[#FFF6EC]">
        <h2 className="text-lg font-bold">คำนวณโควต้า LINE · บอท {activeBot}</h2>
        <p className="mt-1 text-sm text-[#F6E2CF]">
          {groupCount > 0
            ? `กลุ่มของบอท ${activeBot} มีสมาชิก ${memberCount} คน (${memberNote}) การส่ง 1 ครั้งนับเป็น ${memberCount} ข้อความ`
            : `${memberNote} (เมื่อเชิญบอท ${activeBot} เข้ากลุ่มแล้วจะนับจำนวนสมาชิกให้อัตโนมัติ)`}
        </p>
        <label className="mt-4 block text-sm font-semibold" htmlFor="quota-base">
          โควต้าฟรีต่อเดือน (บอท {activeBot})
          <input
            id="quota-base"
            type="number"
            min={1}
            value={quotaLimit ?? plan.quotaBase}
            onChange={(event) => {
              setQuotaLimit(null);
              patchPlan({ quotaBase: Number(event.target.value) || 0 });
            }}
            className="mt-1 h-12 w-full rounded-2xl border border-[#5A3A2C] bg-[#3A241C] px-3 text-lg text-white"
          />
        </label>
        {projection ? (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="ส่งต่อวัน" value={`${projection.pushesPerDay} ครั้ง`} />
            <Stat label="ใช้ต่อวัน" value={`${projection.dailyUse} ข้อความ`} />
            <Stat label="ถ้าใช้ทั้งเดือน" value={`${projection.monthIfChosen} / ${projection.quotaBase}`} />
            <Stat
              label="ใช้ไปแล้วเดือนนี้"
              value={used == null ? quotaError || "ยังอ่านไม่ได้" : `${used} เหลือ ${projection.remaining}`}
            />
            <Stat label="คาดว่าสิ้นเดือนจะใช้" value={`${projection.projectedEnd} ข้อความ`} />
            <Stat
              label="โควต้าจะหมด"
              value={projection.runOutDate ? formatThaiDateShort(projection.runOutDate) : "ไม่หมดในเดือนนี้"}
            />
          </dl>
        ) : null}
        {projection?.overMonth || projection?.overProjected ? (
          <p className="mt-4 rounded-2xl bg-[#7A1F12] px-3 py-3 text-sm leading-6">
            โหมดนี้จะใช้โควต้าบอท {activeBot} เกิน {projection.quotaBase} ข้อความ
            {projection.runOutDate ? ` และน่าจะหมดประมาณวันที่ ${formatThaiDateShort(projection.runOutDate)}` : ""}{" "}
            แนะนำให้ส่งวันละครั้ง หรือลดจำนวนครั้งต่อวัน
          </p>
        ) : (
          <p className="mt-4 rounded-2xl bg-[#1F4A2A] px-3 py-3 text-sm leading-6">
            โหมดนี้ใช้ได้กับโควต้าฟรีบอท {activeBot} ({projection?.quotaBase ?? plan.quotaBase} ข้อความ) ถ้าจำนวนสมาชิกในกลุ่มไม่เพิ่ม
          </p>
        )}
      </section>

      <p className="text-sm leading-6 text-[#6B5348]">
        ปุ่มด้านล่างจะส่งจริงเข้ากลุ่มของ <strong>บอท {activeBot}</strong> และคิดโควต้าจากบอท {activeBot} เท่านั้น (ตอนนี้ประมาณ {memberCount} ข้อความต่อครั้ง)
      </p>
      <div className="flex flex-wrap gap-2">
        {settings.map((setting) => (
          <details key={setting.meal} className="rounded-2xl bg-white px-3 py-2 text-sm">
            <summary className="cursor-pointer font-semibold">{MEAL_MAP[setting.meal].full}</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void send(setting.meal, "test")}>
                ส่งทดสอบ (บอท {activeBot})
              </Button>
              <Button size="sm" onClick={() => void send(setting.meal, "now")}>
                ส่งมื้อนี้ตอนนี้ (บอท {activeBot})
              </Button>
            </div>
          </details>
        ))}
      </div>

      <Button size="lg" onClick={() => void save()} disabled={saving}>
        {saving ? "กำลังบันทึก..." : `บันทึกตารางส่ง บอท ${activeBot}`}
      </Button>
      {savedPlan ? (
        <p className="text-sm text-[#6B5348]">
          ตารางบอท {activeBot} ที่บันทึกไว้เริ่มใช้วันที่ {formatThaiDateShort(savedPlan.effectiveFrom)}
          {clock.iso < savedPlan.effectiveFrom ? " ก่อนหน้านั้นยังส่งแยกตามมื้อ" : ""}
        </p>
      ) : null}

      <section className="rounded-[1.6rem] bg-white p-4">
        <h2 className="text-lg font-bold">บันทึกการส่ง · บอท {activeBot}</h2>
        {logs.length === 0 ? (
          <p className="mt-2 text-sm text-[#6B5348]">ยังไม่มีรายการของบอท {activeBot}</p>
        ) : (
          <>
            <ul className="mt-3 space-y-3 md:hidden">
              {logs.map((log) => (
                <li key={log.id} className="rounded-2xl bg-[#F7FFF4] p-3 text-sm">
                  <p className="font-semibold">
                    {formatThaiDateShort(log.menuDate)} · {MEAL_MAP[log.meal].full}
                  </p>
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

function TwiceCard(props: {
  title: string;
  time: string;
  meals: MealKey[];
  onTime: (value: string) => void;
  onToggle: (meal: MealKey) => void;
}) {
  return (
    <article className="rounded-[1.6rem] bg-white p-4">
      <h2 className="text-xl font-bold">{props.title}</h2>
      <label className="mt-3 block text-sm font-semibold">
        เวลาส่ง
        <input
          type="time"
          value={props.time}
          onChange={(event) => props.onTime(event.target.value)}
          className="mt-1 h-12 w-full rounded-2xl border border-[#E4D3C4] bg-[#FFF9F3] px-3 text-lg"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {MEAL_KEYS.map((meal) => (
          <label key={meal} className="flex items-center gap-2 rounded-2xl bg-[#FFF9F3] px-3 py-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#E8772E]" checked={props.meals.includes(meal)} onChange={() => props.onToggle(meal)} />
            {MEAL_MAP[meal].full}
          </label>
        ))}
      </div>
    </article>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#3A241C] px-3 py-3">
      <dt className="text-xs text-[#F6E2CF]">{props.label}</dt>
      <dd className="mt-1 text-base font-bold text-white">{props.value}</dd>
    </div>
  );
}

function statusText(status: string) {
  switch (status) {
    case "sent":
      return "ส่งแล้ว";
    case "test":
      return "ส่งทดสอบ";
    case "simulated":
      return "จำลอง";
    case "failed":
      return "ส่งไม่สำเร็จ";
    case "claimed":
      return "กำลังส่ง";
    default:
      return status;
  }
}
