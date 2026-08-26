"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API = "/api/v1";
const TOKEN_KEY = "grit_token";

const EMOJIS = ["🔥", "💧", "📖", "🏃", "🧘", "💪", "🥗", "😴", "💊", "🧠", "🎯", "✍️", "🌱", "☀️", "💰", "🎸"];
const COLORS = ["#ea580c", "#e11d48", "#db2777", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#65a30d", "#ca8a04", "#475569"];

type Tpl = { category: string; name: string; icon: string; color: string; type: "checkbox" | "quantity" | "timer"; target?: number; unit?: string };
const TEMPLATES: Tpl[] = [
  { category: "Sức khỏe", name: "Uống 2L nước", icon: "💧", color: "#2563eb", type: "quantity", target: 2000, unit: "ml" },
  { category: "Sức khỏe", name: "Ngủ trước 23h", icon: "😴", color: "#7c3aed", type: "checkbox" },
  { category: "Sức khỏe", name: "Ăn đủ rau xanh", icon: "🥗", color: "#059669", type: "checkbox" },
  { category: "Sức khỏe", name: "Uống vitamin", icon: "💊", color: "#e11d48", type: "checkbox" },
  { category: "Thể dục", name: "Đi bộ 15 phút", icon: "🏃", color: "#ea580c", type: "timer", target: 900 },
  { category: "Thể dục", name: "Tập luyện 20 phút", icon: "💪", color: "#ca8a04", type: "timer", target: 1200 },
  { category: "Thể dục", name: "Vươn vai buổi sáng", icon: "🤸", color: "#0891b2", type: "checkbox" },
  { category: "Học tập", name: "Đọc 10 trang", icon: "📖", color: "#0891b2", type: "quantity", target: 10, unit: "trang" },
  { category: "Học tập", name: "Học từ vựng", icon: "🧠", color: "#7c3aed", type: "checkbox" },
  { category: "Học tập", name: "Luyện tập 30 phút", icon: "🎯", color: "#e11d48", type: "timer", target: 1800 },
  { category: "Tài chính", name: "Ghi chi tiêu hôm nay", icon: "💰", color: "#65a30d", type: "checkbox" },
  { category: "Tài chính", name: "Không tiêu bốc đồng", icon: "🛍️", color: "#db2777", type: "checkbox" },
  { category: "Tinh thần", name: "Thiền 5 phút", icon: "🧘", color: "#0891b2", type: "timer", target: 300 },
  { category: "Tinh thần", name: "Nhật ký biết ơn", icon: "✍️", color: "#db2777", type: "checkbox" },
  { category: "Tinh thần", name: "Không MXH buổi sáng", icon: "📵", color: "#475569", type: "checkbox" },
];
const TPL_CATEGORIES = Array.from(new Set(TEMPLATES.map((t) => t.category)));

function todayLocal(): string { return new Date().toLocaleDateString("en-CA"); }
function daysAgoLocal(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA"); }
function weekStartLocal(): string { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toLocaleDateString("en-CA"); }
function tint(hex: string, pct = 16) { return `color-mix(in srgb, ${hex} ${pct}%, var(--panel))`; }

const MOODS = ["😞", "😕", "😐", "🙂", "😄"]; // index+1 = giá trị mood
const MOOD_META = [
  { v: 1, emoji: "😖", label: "Tệ", color: "#e03131" },
  { v: 2, emoji: "🙁", label: "Kém", color: "#e8760c" },
  { v: 3, emoji: "😐", label: "Ổn", color: "#f59f00" },
  { v: 4, emoji: "🙂", label: "Vui", color: "#82c91e" },
  { v: 5, emoji: "🤩", label: "Tuyệt", color: "#2f9e44" },
];
const moodMeta = (v: number) => MOOD_META.find((m) => m.v === v) || MOOD_META[2];
const ACCENTS = ["#ea580c", "#e11d48", "#7c3aed", "#2563eb", "#0891b2", "#059669"]; // [0] = mặc định
function hexToRgba(hex: string, a: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function applyTheme(t: string) {
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else root.removeAttribute("data-theme");
}
// App Badge: số việc còn lại hiện trên icon PWA đã cài (no-op nếu chưa cài / không hỗ trợ).
function setBadge(n: number) {
  try {
    const nav = navigator as any;
    if ("setAppBadge" in nav) { if (n > 0) nav.setAppBadge(n); else nav.clearAppBadge?.(); }
  } catch {}
}

function urlB64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function subscribePush(token: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Trình duyệt không hỗ trợ thông báo đẩy.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Bạn chưa cấp quyền thông báo.");
  const vapid = await apiCall("/push/vapid", { token });
  if (!vapid.json?.enabled || !vapid.json?.publicKey) throw new Error("Máy chủ chưa bật push (thiếu VAPID).");
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapid.json.publicKey) });
  const j: any = sub.toJSON();
  await apiCall("/push/subscribe", { method: "POST", token, body: { endpoint: j.endpoint, keys: j.keys } });
}

function applyAccent(hex: string | null) {
  const root = document.documentElement;
  if (hex && hex !== ACCENTS[0]) {
    root.style.setProperty("--ember", hex);
    root.style.setProperty("--ember-deep", hex);
    root.style.setProperty("--ember-glow", hexToRgba(hex, 0.18));
  } else {
    root.style.removeProperty("--ember");
    root.style.removeProperty("--ember-deep");
    root.style.removeProperty("--ember-glow");
  }
}

async function apiCall(path: string, opts: { method?: string; token?: string | null; body?: unknown } = {}) {
  const res = await fetch(API + path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const Flame = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 2c1 3.5-1.5 4.8-1.5 7.2 0 1.2.8 2 .8 2 0-1.8 1.4-2.6 1.4-2.6.4 2.2 2.8 3 2.8 6.1A5.5 5.5 0 1 1 6 14.3C6 9 11 8 12 2Z" />
  </svg>
);
const CheckMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);

export default function App() {
  const [view, setView] = useState<"loading" | "auth" | "onboarding" | "app">("loading");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<"today" | "habits" | "stats" | "awards">("today");
  const [settings, setSettings] = useState(false);
  const [autoAdd, setAutoAdd] = useState(false);

  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get("tab");
      if (t && ["today", "habits", "stats", "awards"].includes(t)) setTab(t as any);
      if (q.get("action") === "add") setAutoAdd(true);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      applyTheme(localStorage.getItem("grit_theme") || "system");
      applyAccent(localStorage.getItem("grit_accent"));
    } catch {}
  }, []);

  const loadState = useCallback(async (tk: string) => {
    const meRes = await apiCall("/users/me", { token: tk });
    if (meRes.status === 401) { doLogout(); return; }
    setMe(meRes.json);
    const habits = await apiCall("/habits", { token: tk });
    setView((habits.json?.data?.length ?? 0) === 0 ? "onboarding" : "app");
  }, []);

  useEffect(() => {
    let tk: string | null = null;
    try { tk = localStorage.getItem(TOKEN_KEY); } catch {}
    if (tk) { setToken(tk); loadState(tk); } else setView("auth");
  }, [loadState]);

  function doLogout() { try { localStorage.removeItem(TOKEN_KEY); } catch {} setToken(null); setMe(null); setTab("today"); setView("auth"); }

  return (
    <main className="app">
      <div className="brand-row">
        {view === "app" ? (
          <button className="brand-mark clickable" onClick={() => setSettings((s) => !s)} aria-label="Cài đặt"><Flame size={22} /></button>
        ) : (
          <span className="brand-mark"><Flame size={22} /></span>
        )}
        <b>Grit</b>
        {me && <span className="who">{me.email}</span>}
        {view === "app" && <button className="linkbtn" onClick={() => setSettings((s) => !s)} style={{ marginLeft: 8 }}>{settings ? "Đóng" : "Cài đặt"}</button>}
      </div>

      {view === "loading" && <div className="center-screen">Đang tải…</div>}
      {view === "auth" && <AuthView onAuthed={(tk) => { setToken(tk); try { localStorage.setItem(TOKEN_KEY, tk); } catch {} setView("loading"); loadState(tk); }} />}
      {view === "onboarding" && token && <OnboardingView token={token} onDone={() => { setView("loading"); loadState(token); }} />}

      {view === "app" && token && settings && (
        <SettingsScreen token={token} me={me} onLogout={doLogout} />
      )}

      {view === "app" && token && !settings && (
        <>
          <div className="tabcontent">
            {tab === "today" && <TodayTab token={token} goHabits={() => setTab("habits")} />}
            {tab === "habits" && <HabitsTab token={token} autoAdd={autoAdd} onConsumeAdd={() => setAutoAdd(false)} />}
            {tab === "stats" && <StatsTab token={token} />}
            {tab === "awards" && <AwardsTab token={token} />}
          </div>
          <nav className="tabbar">
            <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8M4 12v6a2 2 0 002 2h12" /></svg>Hôm nay
            </button>
            <button className={tab === "habits" ? "on" : ""} onClick={() => setTab("habits")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>Thói quen
            </button>
            <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18M7 14l4-4 3 3 5-6" /></svg>Thống kê
            </button>
            <button className={tab === "awards" ? "on" : ""} onClick={() => setTab("awards")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" /></svg>Thành tựu
            </button>
          </nav>
        </>
      )}
    </main>
  );
}

/* ---------------- Settings (premium) ---------------- */
function SettingsScreen({ token, me, onLogout }: { token: string; me: any; onLogout: () => void }) {
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem("grit_theme") || "system"; } catch { return "system"; } });
  const [accent, setAccent] = useState<string>(() => { try { return localStorage.getItem("grit_accent") || ACCENTS[0]; } catch { return ACCENTS[0]; } });
  const [tz, setTz] = useState(me?.timezone || "Asia/Ho_Chi_Minh");
  const [cutoff, setCutoff] = useState(me?.dayCutoff || "00:00");
  const [savedMsg, setSavedMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [badgeMsg, setBadgeMsg] = useState("");
  const [reminderOn, setReminderOn] = useState(!!me?.reminderEnabled);
  const [reminderTime, setReminderTime] = useState(me?.reminderTime || "20:00");
  const [remindMsg, setRemindMsg] = useState("");

  async function toggleReminder(on: boolean) {
    setRemindMsg("");
    if (on) {
      try {
        await subscribePush(token);
        await apiCall("/users/me", { method: "PATCH", token, body: { reminder_enabled: true, reminder_time: reminderTime } });
        setReminderOn(true); setRemindMsg("✓ Đã bật nhắc nhở");
      } catch (e: any) { setRemindMsg(e?.message || "Không bật được."); }
    } else {
      await apiCall("/users/me", { method: "PATCH", token, body: { reminder_enabled: false } });
      setReminderOn(false); setRemindMsg("Đã tắt nhắc nhở");
    }
    setTimeout(() => setRemindMsg(""), 3500);
  }
  async function saveReminderTime(t: string) {
    setReminderTime(t);
    await apiCall("/users/me", { method: "PATCH", token, body: { reminder_time: t } });
    setRemindMsg("✓ Đã lưu giờ nhắc"); setTimeout(() => setRemindMsg(""), 2500);
  }

  async function enableBadge() {
    try {
      if ("Notification" in window && Notification.permission !== "granted") await Notification.requestPermission();
      setBadgeMsg("Đã bật. Cài app vào màn hình chính để thấy số việc trên icon.");
    } catch { setBadgeMsg("Trình duyệt/thiết bị chưa hỗ trợ huy hiệu."); }
    setTimeout(() => setBadgeMsg(""), 3500);
  }

  function chooseTheme(t: string) { setTheme(t); applyTheme(t); try { localStorage.setItem("grit_theme", t); } catch {} }
  function chooseAccent(a: string) { setAccent(a); applyAccent(a); try { localStorage.setItem("grit_accent", a); } catch {} }

  async function saveTime() {
    await apiCall("/users/me", { method: "PATCH", token, body: { timezone: tz, day_cutoff: cutoff } });
    setSavedMsg("Đã lưu"); setTimeout(() => setSavedMsg(""), 2500);
  }

  async function exportData() {
    setExporting(true);
    const r = await apiCall("/export", { token });
    setExporting(false);
    if (r.status !== 200) return;
    const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "grit-export.json";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  const TZS = Array.from(new Set([tz, "Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Tokyo", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"]));

  return (
    <div className="tabcontent">
      <div className="section-title">Cài đặt</div>

      <div className="set-block">
        <div className="set-label">Giao diện</div>
        <div className="seg3">
          {[["system", "Hệ thống"], ["light", "Sáng"], ["dark", "Tối"]].map(([v, l]) => (
            <button key={v} className={theme === v ? "on" : ""} onClick={() => chooseTheme(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Màu chủ đạo</div>
        <div className="accent-row">
          {ACCENTS.map((a) => (
            <button key={a} className={`pick-color${a === accent ? " on" : ""}`} style={{ background: a, color: a }} onClick={() => chooseAccent(a)} aria-label={a} />
          ))}
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Múi giờ & giờ đổi ngày</div>
        <div className="card">
          <label>Múi giờ</label>
          <select value={tz} onChange={(e) => setTz(e.target.value)}>{TZS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <label>Giờ đổi ngày (cut-off)</label>
          <input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>VD 03:00 nếu hay thức khuya — trước giờ này vẫn tính là "hôm qua".</div>
          <button className="btn" onClick={saveTime}>Lưu</button>
          {savedMsg && <div style={{ textAlign: "center", marginTop: 10 }}><span className="saved-tag">✓ {savedMsg}</span></div>}
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Nhắc nhở hằng ngày</div>
        <div className="card">
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={reminderOn} onChange={(e) => toggleReminder(e.target.checked)} style={{ width: "auto" }} />
            <span>Nhắc điểm danh mỗi ngày (thông báo đẩy)</span>
          </label>
          {reminderOn && (
            <>
              <label>Giờ nhắc</label>
              <input type="time" value={reminderTime} onChange={(e) => saveReminderTime(e.target.value)} />
            </>
          )}
          {remindMsg && <div className="mood-note-saved">{remindMsg}</div>}
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>iOS: cần thêm app vào Màn hình chính (iOS 16.4+) mới nhận được thông báo.</div>
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Widget & huy hiệu icon</div>
        <div className="card">
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Cài app vào màn hình chính (Chia sẻ → Thêm vào Màn hình chính), rồi bật huy hiệu để thấy <b>số việc còn lại</b> ngay trên icon. Long-press icon để mở nhanh (Hôm nay / Thêm / Tâm trạng).</div>
          <button className="btn ghost" onClick={enableBadge}>Bật huy hiệu trên icon</button>
          {badgeMsg && <div style={{ textAlign: "center", marginTop: 10 }}><span className="saved-tag">{badgeMsg}</span></div>}
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Dữ liệu</div>
        <div className="card">
          <button className="btn ghost" onClick={exportData} disabled={exporting}>{exporting ? "Đang xuất…" : "⬇ Xuất dữ liệu (JSON)"}</button>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Tải toàn bộ mục tiêu, thói quen, lịch sử, nhật ký về máy để sao lưu.</div>
        </div>
      </div>

      <div className="set-block">
        <div className="set-label">Tài khoản</div>
        <div className="card">
          <div style={{ fontSize: 14, marginBottom: 12 }}>{me?.email}</div>
          <button className="btn" style={{ background: "#d64545", boxShadow: "none" }} onClick={onLogout}>Đăng xuất</button>
        </div>
      </div>

      <div className="about">Grit Tracker · MVP</div>
    </div>
  );
}

/* ---------------- Auth ---------------- */
function AuthView({ onAuthed }: { onAuthed: (token: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@grit.app");
  const [password, setPassword] = useState("demo1234");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh";
    const path = mode === "login" ? "/auth/login" : "/auth/register";
    const body = mode === "login" ? { email, password } : { email, password, timezone: tz };
    const r = await apiCall(path, { method: "POST", body });
    setBusy(false);
    if (r.status === 200 || r.status === 201) onAuthed(r.json.access_token);
    else setErr(r.json?.error?.message || "Có lỗi xảy ra.");
  }

  return (
    <>
      <h1>{mode === "login" ? "Chào mừng trở lại" : "Bắt đầu hành trình"}</h1>
      <p className="sub">Một việc siêu nhỏ mỗi ngày. Giữ ngọn lửa đừng tắt.</p>
      <div className="card">
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label>Mật khẩu</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button>
        <div className="err">{err}</div>
        <div className="toggle">
          {mode === "login" ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
          <button onClick={() => { setErr(""); setMode(mode === "login" ? "register" : "login"); }}>{mode === "login" ? "Đăng ký" : "Đăng nhập"}</button>
        </div>
      </div>
      <div className="footnote">Demo: demo@grit.app / demo1234</div>
    </>
  );
}

/* ---------------- Onboarding ---------------- */
function OnboardingView({ token, onDone }: { token: string; onDone: () => void }) {
  const [mode, setMode] = useState<"templates" | "custom">("templates");
  const [cat, setCat] = useState(TPL_CATEGORIES[0]);
  const [sel, setSel] = useState<Tpl[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState(false);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [goal, setGoal] = useState("");
  const [habit, setHabit] = useState("");
  const [icon, setIcon] = useState("🔥");
  const [color, setColor] = useState(COLORS[0]);

  const keyOf = (t: Tpl) => `${t.category}|${t.name}`;
  const isSel = (t: Tpl) => sel.some((s) => keyOf(s) === keyOf(t));
  function toggle(t: Tpl) { setErr(""); setSel((cur) => isSel(t) ? cur.filter((s) => keyOf(s) !== keyOf(t)) : [...cur, t]); }

  async function commitTemplates() {
    setHolding(false); setBusy(true);
    try {
      const cats = Array.from(new Set(sel.map((s) => s.category)));
      const goalId: Record<string, any> = {};
      for (const c of cats) {
        const g = await apiCall("/goals", { method: "POST", token, body: { title: c } });
        if (g.status !== 201) throw new Error();
        goalId[c] = g.json.id;
      }
      let first = true;
      for (const t of sel) {
        const schedule: any = { schedule_type: "daily", weekdays_mask: 127, effective_from: todayLocal(), min_percent: 100 };
        if (t.type !== "checkbox") { schedule.target_value = t.target; if (t.unit) schedule.target_unit = t.unit; }
        await apiCall("/habits", { method: "POST", token, body: { goal_id: goalId[t.category], name: t.name, type: t.type, icon: t.icon, color: t.color, is_focus: first, schedule } });
        first = false;
      }
      onDone();
    } catch { setBusy(false); setErr("Có lỗi khi tạo. Thử lại."); }
  }

  function holdStart() {
    if (busy) return;
    if (!sel.length) { setErr("Chọn ít nhất 1 thói quen để bắt đầu."); return; }
    setHolding(true);
    holdRef.current = setTimeout(() => { commitTemplates(); }, 1200);
  }
  function holdCancel() {
    setHolding(false);
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
  }

  async function createCustom() {
    if (!goal.trim() || !habit.trim()) { setErr("Nhập cả mục tiêu và việc hôm nay."); return; }
    setErr(""); setBusy(true);
    const g = await apiCall("/goals", { method: "POST", token, body: { title: goal } });
    if (g.status !== 201) { setBusy(false); setErr("Lỗi tạo mục tiêu."); return; }
    const h = await apiCall("/habits", { method: "POST", token, body: { goal_id: g.json.id, name: habit, type: "checkbox", is_focus: true, icon, color, schedule: { schedule_type: "daily", weekdays_mask: 127, effective_from: todayLocal() } } });
    setBusy(false);
    if (h.status !== 201) { setErr("Lỗi tạo thói quen."); return; }
    onDone();
  }

  if (mode === "custom") {
    return (
      <>
        <h1>Tự tạo thói quen</h1>
        <p className="sub">Nhập mục tiêu lớn và một việc siêu nhỏ cho hôm nay.</p>
        <div className="card">
          <label>Mục tiêu lớn</label>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="VD: Chạy 5km" />
          <label>Việc hôm nay (siêu nhỏ)</label>
          <input value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="VD: Xỏ giày & đi bộ 5 phút" />
          <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
          <button className="btn" onClick={createCustom} disabled={busy}>{busy ? "Đang tạo…" : "Bắt đầu"}</button>
          <button className="linkbtn" style={{ marginTop: 12, display: "block", marginInline: "auto" }} onClick={() => { setMode("templates"); setErr(""); }}>← Chọn từ mẫu</button>
          <div className="err">{err}</div>
        </div>
      </>
    );
  }

  const catItems = TEMPLATES.filter((t) => t.category === cat);
  return (
    <>
      <h1>Chọn thói quen để bắt đầu</h1>
      <p className="sub">Chọn vài việc nhỏ bạn muốn xây — có thể sửa sau.</p>
      <div className="picker">
        {TPL_CATEGORIES.map((c) => <button key={c} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="tpl-list">
        {catItems.map((t) => (
          <button type="button" className={`tpl-item${isSel(t) ? " on" : ""}`} key={keyOf(t)} onClick={() => toggle(t)}>
            <span className="hicon" style={{ background: tint(t.color) }}>{t.icon}</span>
            <span className="tt">
              <b>{t.name}</b>
              <small>{t.type === "checkbox" ? "Đánh dấu" : t.type === "timer" ? `${t.target}s` : `${t.target} ${t.unit || ""}`}</small>
            </span>
            <span className="tsel"><CheckMark /></span>
          </button>
        ))}
      </div>

      <button
        className={`commit-btn${holding ? " holding" : ""}`}
        onPointerDown={holdStart} onPointerUp={holdCancel} onPointerLeave={holdCancel}
        disabled={busy}
      >
        <span className="cfill" />
        <span className="clabel">{busy ? "Đang tạo…" : sel.length ? `Giữ để cam kết (${sel.length})` : "Chọn ít nhất 1 thói quen"}</span>
      </button>
      <div className="commit-hint">Giữ nút ~1 giây để xác nhận — bạn nghiêm túc với những thói quen này.</div>
      <button className="linkbtn" style={{ marginTop: 12, display: "block", marginInline: "auto" }} onClick={() => { setMode("custom"); setErr(""); }}>Hoặc tự tạo thủ công →</button>
      <div className="err" style={{ textAlign: "center" }}>{err}</div>
    </>
  );
}

function IconColorPicker({ icon, color, onIcon, onColor }: { icon: string; color: string; onIcon: (v: string) => void; onColor: (v: string) => void }) {
  return (
    <>
      <label>Biểu tượng</label>
      <div className="pick-grid">
        {EMOJIS.map((e) => <button key={e} type="button" className={`pick-emoji${e === icon ? " on" : ""}`} onClick={() => onIcon(e)}>{e}</button>)}
      </div>
      <label>Màu</label>
      <div className="pick-grid">
        {COLORS.map((c) => <button key={c} type="button" className={`pick-color${c === color ? " on" : ""}`} style={{ background: c, color: c }} onClick={() => onColor(c)} aria-label={c} />)}
      </div>
      <div className="preview-chip" style={{ background: tint(color, 18) }}>{icon}</div>
    </>
  );
}

/* ---------------- Today (Grit-style list) ---------------- */
function MoodWidget({ token }: { token: string }) {
  const [mood, setMood] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiCall(`/mood?from=${todayLocal()}&to=${todayLocal()}`, { token }).then((r) => {
      const row = (r.json?.data || [])[0]; if (row) { setMood(row.mood); setNote(row.note || ""); }
    });
  }, [token]);

  async function save(m: number, n: string) {
    await apiCall("/mood", { method: "POST", token, body: { logged_date: todayLocal(), mood: m, note: n || undefined } });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }
  function pick(m: number) { setMood(m); save(m, note); }

  return (
    <div className="mood-card">
      <span className="ml">Hôm nay bạn thấy thế nào?</span>
      <div className="mood-faces">
        {MOOD_META.map((mm) => (
          <button key={mm.v} className={`mood-face${mood === mm.v ? " on" : ""}`} onClick={() => pick(mm.v)} aria-label={mm.label}>
            <span className="fc" style={mood === mm.v ? { borderColor: mm.color, background: `color-mix(in srgb, ${mm.color} 16%, var(--panel-2))` } : undefined}>{mm.emoji}</span>
            <span className="fl">{mm.label}</span>
          </button>
        ))}
      </div>
      {mood != null && (
        !showNote
          ? <button className="mood-note-toggle" onClick={() => setShowNote(true)}>{note ? "✎ " + note.slice(0, 40) : "＋ Thêm ghi chú tâm trạng"}</button>
          : (
            <div className="note-wrap">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Điều gì khiến bạn thấy vậy?" />
              <button className="btn" style={{ marginTop: 8, padding: 10, fontSize: 14 }} onClick={() => { save(mood, note); setShowNote(false); }}>Lưu</button>
            </div>
          )
      )}
      {saved && <div className="mood-note-saved">✓ Đã ghi tâm trạng</div>}
    </div>
  );
}

function NoteEditor({ token, habitId, initial, onSaved }: { token: string; habitId: string; initial: string | null; onSaved: () => void }) {
  const [text, setText] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    await apiCall(`/habits/${habitId}/logs/${todayLocal()}`, { method: "PATCH", token, body: { note: text } });
    setBusy(false); onSaved();
  }
  return (
    <div className="note-wrap">
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ghi chú / cảm nhận hôm nay…" />
      <button className="btn" style={{ marginTop: 8, padding: 10, fontSize: 14 }} onClick={save} disabled={busy}>{busy ? "Đang lưu…" : "Lưu ghi chú"}</button>
    </div>
  );
}

function FocusTimer({ item, token, onClose, onDone }: { item: any; token: string; onClose: () => void; onDone: () => void }) {
  const target: number = item.target_value || 60;
  const [left, setLeft] = useState<number>(target);
  const [running, setRunning] = useState(true);
  const [finishing, setFinishing] = useState(false);

  const finish = useCallback(async () => {
    setFinishing(true);
    await apiCall(`/habits/${item.habit_id}/logs`, { method: "POST", token, body: { logged_date: todayLocal(), duration_secs: target } });
    onDone();
  }, [item.habit_id, target, token, onDone]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => { if (left === 0 && !finishing) finish(); }, [left, finishing, finish]);

  const mm = Math.floor(left / 60), ss = left % 60;
  const C = 2 * Math.PI * 95;
  const pct = target ? 1 - left / target : 0;
  return (
    <div className="timer-overlay">
      <div className="tname">{item.icon} {item.name}</div>
      <div className="timer-ring">
        <svg viewBox="0 0 220 220">
          <circle cx="110" cy="110" r="95" fill="none" stroke="var(--line)" strokeWidth="12" />
          <circle cx="110" cy="110" r="95" fill="none" stroke={item.color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <div className="tt">{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</div>
      </div>
      <div className="timer-ctrls">
        <button onClick={() => setRunning((r) => !r)}>{running ? "Tạm dừng" : "Tiếp tục"}</button>
        <button onClick={finish} disabled={finishing}>Hoàn thành</button>
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}

function TodayTab({ token, goHabits }: { token: string; goHabits: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState<string | null>(null);
  const [timerFor, setTimerFor] = useState<any>(null);

  const load = useCallback(async () => {
    const r = await apiCall("/dashboard/today", { token });
    setItems((r.json?.items ?? []).filter((it: any) => it.today_status !== "not_due"));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!items) return;
    setBadge(items.filter((it) => it.today_status === "pending").length);
  }, [items]);

  async function toggle(it: any) {
    const id = String(it.habit_id);
    const done = it.today_status === "completed" || it.today_status === "partial";
    setBusyId(id);
    if (done) {
      await apiCall(`/habits/${id}/logs/${todayLocal()}`, { method: "DELETE", token });
    } else {
      const body: any = { logged_date: todayLocal() };
      if (it.type === "timer") body.duration_secs = it.target_value ?? 0;
      if (it.type === "quantity") body.value = it.target_value ?? 0;
      await apiCall(`/habits/${id}/logs`, { method: "POST", token, body });
    }
    await load();
    setBusyId(null);
  }

  if (items === null) return <div className="center-screen">Đang tải…</div>;

  const total = items.length;
  const doneCount = items.filter((it) => it.today_status === "completed" || it.today_status === "partial").length;
  const pct = total ? (doneCount / total) * 100 : 0;
  const C = 2 * Math.PI * 25;

  const groups: Record<string, any[]> = {};
  for (const it of items) { const k = it.goal_title || "Khác"; (groups[k] ||= []).push(it); }
  const isDoneS = (s: string) => s === "completed" || s === "partial";

  return (
    <div className="today-top">
      {timerFor && <FocusTimer item={timerFor} token={token} onClose={() => setTimerFor(null)} onDone={() => { setTimerFor(null); load(); }} />}
      <div className="hello">Hôm nay</div>
      <div className="date">{new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })}</div>

      <MoodWidget token={token} />

      {total > 0 ? (
        <>
          <div className="summary">
            <div className="ring2">
              <svg viewBox="0 0 58 58">
                <circle cx="29" cy="29" r="25" fill="none" stroke="var(--line)" strokeWidth="6" />
                <circle cx="29" cy="29" r="25" fill="none" stroke="var(--ember)" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
              </svg>
              <span>{doneCount}/{total}</span>
            </div>
            <div className="s-txt">
              <b>{doneCount === total ? "Hoàn thành cả ngày! 🎉" : `Còn ${total - doneCount} việc hôm nay`}</b>
              <small>Chạm vòng tròn để đánh dấu — giữ ngọn lửa cháy.</small>
            </div>
          </div>

          {Object.entries(groups).map(([g, hs]) => {
            const groupHasDone = hs.some((x) => isDoneS(x.today_status));
            const cueIdx = groupHasDone ? hs.findIndex((x) => x.today_status === "pending") : -1;
            return (
              <div key={g}>
                <div className="group-title">{g}</div>
                <div className="hlist">
                  {hs.map((it, idx) => {
                    const done = isDoneS(it.today_status);
                    const frozen = it.today_status === "frozen";
                    const bad = it.polarity === "bad";
                    return (
                      <div key={it.habit_id}>
                        <div className={`hrow${done ? " is-done" : ""}`}>
                          <span className="hicon" style={{ background: tint(it.color) }}>{it.icon}</span>
                          <button className="hbody" onClick={() => done && setNoteOpen(noteOpen === String(it.habit_id) ? null : String(it.habit_id))}>
                            <b>{it.name}{done && <span className="note-dot">📝</span>}</b>
                            <small>
                              <span className="st">🔥{it.current_streak}</span>
                              {bad && <> · <span className="polar-tag">🚫 tránh</span></>}
                              {it.type !== "checkbox" && it.target_value ? ` · ${it.target_value}${it.type === "timer" ? "s" : " " + (it.target_unit || "")}` : ""}
                              {idx === cueIdx && <span className="cue">KẾ TIẾP →</span>}
                            </small>
                          </button>
                          {!done && !frozen && it.type === "timer" && (
                            <button className="timer-launch" onClick={() => setTimerFor(it)} title="Bắt đầu hẹn giờ" aria-label="Hẹn giờ">▶</button>
                          )}
                          {frozen ? (
                            <span className="check frozen" title="Được Freeze bảo vệ">❄</span>
                          ) : (
                            <button className={`check${done ? " done" : ""}`} style={done ? { background: it.color, borderColor: it.color } : undefined}
                              onClick={() => toggle(it)} disabled={busyId === String(it.habit_id)} aria-label={done ? "Bỏ đánh dấu" : bad ? "Đã tránh hôm nay" : "Hoàn thành"}>
                              <CheckMark />
                            </button>
                          )}
                        </div>
                        {done && it.today_note && noteOpen !== String(it.habit_id) && <div className="note-view">“{it.today_note}”</div>}
                        {done && noteOpen === String(it.habit_id) && (
                          <NoteEditor token={token} habitId={String(it.habit_id)} initial={it.today_note} onSaved={() => { setNoteOpen(null); load(); }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <div className="empty-today">
          <div className="big">🎉</div>
          <div>Hôm nay không có việc đến hạn.</div>
          <button className="btn ghost" style={{ width: "auto", padding: "10px 18px", margin: "16px auto 0" }} onClick={goHabits}>Thêm thói quen</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Habits (manage) ---------------- */
function HabitsTab({ token, autoAdd, onConsumeAdd }: { token: string; autoAdd?: boolean; onConsumeAdd?: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => { if (autoAdd) { setAdding(true); onConsumeAdd?.(); } }, [autoAdd, onConsumeAdd]);

  const load = useCallback(async () => {
    const r = await apiCall("/habits", { token });
    setItems(r.json?.data ?? []);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (adding) return <AddHabit token={token} onClose={(c) => { setAdding(false); if (c) load(); }} />;
  if (editing) return <HabitEdit token={token} id={editing} onClose={(c) => { setEditing(null); if (c) load(); }} />;

  return (
    <>
      <div className="section-title">Thói quen</div>
      {items === null ? <div className="center-screen">Đang tải…</div> : (
        <div className="hlist">
          {items.length === 0 && <div className="footnote">Chưa có thói quen nào.</div>}
          {items.map((h) => (
            <button className="hrow" key={h.id} onClick={() => setEditing(String(h.id))} style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
              <span className="hicon" style={{ background: tint(h.color) }}>{h.icon}</span>
              <div className="hbody" style={{ pointerEvents: "none" }}>
                <b>{h.name}{h.is_focus ? " ⭐" : ""}</b>
                <small><span className="st">🔥{h.current_streak}</span> · {h.type} · sửa</small>
              </div>
            </button>
          ))}
        </div>
      )}
      <button className="add-fab" onClick={() => setAdding(true)}>＋ Thêm thói quen</button>
    </>
  );
}

function AddHabit({ token, onClose }: { token: string; onClose: (created: boolean) => void }) {
  const [goals, setGoals] = useState<any[]>([]);
  const [goalId, setGoalId] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"checkbox" | "quantity" | "timer">("checkbox");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [polarity, setPolarity] = useState<"good" | "bad">("good");
  const [icon, setIcon] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [allow, setAllow] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiCall("/goals", { token }).then((r) => { const gs = r.json?.data ?? []; setGoals(gs); setGoalId(gs[0]?.id ? String(gs[0].id) : "new"); });
  }, [token]);

  async function submit() {
    if (!name.trim()) { setErr("Nhập tên thói quen."); return; }
    if (type !== "checkbox" && !target.trim()) { setErr("Nhập mục tiêu định lượng/thời gian."); return; }
    setErr(""); setBusy(true);
    let gid = goalId;
    if (goalId === "new") {
      const g = await apiCall("/goals", { method: "POST", token, body: { title: newGoal.trim() || "Mục tiêu của tôi" } });
      if (g.status !== 201) { setBusy(false); setErr("Lỗi tạo mục tiêu."); return; }
      gid = String(g.json.id);
    }
    const schedule: any = { schedule_type: "daily", weekdays_mask: 127, effective_from: todayLocal(), min_percent: 100 };
    if (type !== "checkbox") { schedule.target_value = Number(target); if (unit) schedule.target_unit = unit; }
    const h = await apiCall("/habits", { method: "POST", token, body: { goal_id: gid, name, type, is_focus: false, icon, color, polarity, weekly_miss_allowance: allow, schedule } });
    setBusy(false);
    if (h.status !== 201) { setErr(h.json?.error?.message || "Lỗi tạo thói quen."); return; }
    onClose(true);
  }

  return (
    <>
      <div className="section-title">Thêm thói quen</div>
      <div className="card">
        <label>Chọn nhanh từ mẫu</label>
        <div className="tpl-quick">
          {TEMPLATES.map((t) => (
            <button type="button" key={`${t.category}|${t.name}`} onClick={() => {
              setName(t.name); setType(t.type); setIcon(t.icon); setColor(t.color);
              setTarget(t.target ? String(t.target) : ""); setUnit(t.unit || "");
            }}>{t.icon} {t.name}</button>
          ))}
        </div>
        <label>Thuộc mục tiêu</label>
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {goals.map((g) => <option key={g.id} value={String(g.id)}>{g.title}</option>)}
          <option value="new">＋ Mục tiêu mới…</option>
        </select>
        {goalId === "new" && (<><label>Tên mục tiêu mới</label><input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="VD: Đọc sách" /></>)}
        <label>Tên thói quen</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Đọc 1 trang" />
        <label>Tính chất</label>
        <select value={polarity} onChange={(e) => setPolarity(e.target.value as any)}>
          <option value="good">Thói quen tốt (muốn xây)</option>
          <option value="bad">Thói quen xấu (muốn bỏ — "ngày tránh được")</option>
        </select>
        <label>Loại</label>
        <select value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="checkbox">Checkbox (đánh dấu xong)</option>
          <option value="quantity">Định lượng (số lượng)</option>
          <option value="timer">Timer (thời gian)</option>
        </select>
        {type !== "checkbox" && (
          <>
            <label>{type === "timer" ? "Mục tiêu (giây)" : "Mục tiêu (số lượng)"}</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" placeholder={type === "timer" ? "300" : "2000"} />
            {type === "quantity" && (<><label>Đơn vị</label><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ml, km, trang…" /></>)}
          </>
        )}
        <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
        <label>Cho phép bỏ lỡ mỗi tuần</label>
        <select value={allow} onChange={(e) => setAllow(Number(e.target.value))}>
          <option value={0}>Nghiêm ngặt — bỏ lỡ là mất chuỗi</option>
          <option value={1}>1 lần/tuần vẫn giữ chuỗi</option>
          <option value={2}>2 lần/tuần vẫn giữ chuỗi</option>
          <option value={3}>3 lần/tuần vẫn giữ chuỗi</option>
        </select>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>Cho phép nghỉ vài hôm/tuần mà không đứt chuỗi (khác với Freeze — hạn mức này miễn phí, tự làm mới mỗi tuần).</div>
        <button className="btn" onClick={submit} disabled={busy}>{busy ? "Đang lưu…" : "Lưu thói quen"}</button>
        <button className="linkbtn" style={{ marginTop: 12, display: "block", marginInline: "auto" }} onClick={() => onClose(false)}>Hủy</button>
        <div className="err">{err}</div>
      </div>
    </>
  );
}

function HabitEdit({ token, id, onClose }: { token: string; id: string; onClose: (changed: boolean) => void }) {
  const [habit, setHabit] = useState<any>(null);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState(false);
  const [icon, setIcon] = useState(EMOJIS[0]);
  const [color, setColor] = useState(COLORS[0]);
  const [allow, setAllow] = useState(0);
  const [polarity, setPolarity] = useState<"good" | "bad">("good");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiCall(`/habits/${id}`, { token }).then((r) => {
      if (r.status === 200) { setHabit(r.json); setName(r.json.name); setFocus(!!r.json.is_focus); setIcon(r.json.icon || "🔥"); setColor(r.json.color || COLORS[0]); setAllow(r.json.weekly_miss_allowance ?? 0); setPolarity(r.json.polarity || "good"); }
    });
  }, [id, token]);

  async function save() {
    if (!name.trim()) { setErr("Tên không được trống."); return; }
    setErr(""); setBusy(true);
    const r = await apiCall(`/habits/${id}`, { method: "PATCH", token, body: { name, is_focus: focus, icon, color, polarity, weekly_miss_allowance: allow } });
    setBusy(false);
    if (r.status === 200) onClose(true); else setErr(r.json?.error?.message || "Lỗi lưu.");
  }
  async function del() {
    setBusy(true);
    const r = await apiCall(`/habits/${id}`, { method: "DELETE", token });
    setBusy(false);
    if (r.status === 204) onClose(true); else setErr("Lỗi xóa.");
  }

  if (!habit) return <div className="center-screen">Đang tải…</div>;

  return (
    <>
      <div className="section-title">Sửa thói quen</div>
      <div className="card">
        <label>Tên thói quen</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
        <label>Cho phép bỏ lỡ mỗi tuần</label>
        <select value={allow} onChange={(e) => setAllow(Number(e.target.value))}>
          <option value={0}>Nghiêm ngặt — bỏ lỡ là mất chuỗi</option>
          <option value={1}>1 lần/tuần vẫn giữ chuỗi</option>
          <option value={2}>2 lần/tuần vẫn giữ chuỗi</option>
          <option value={3}>3 lần/tuần vẫn giữ chuỗi</option>
        </select>
        <label>Tính chất</label>
        <select value={polarity} onChange={(e) => setPolarity(e.target.value as any)}>
          <option value="good">Thói quen tốt (muốn xây)</option>
          <option value="bad">Thói quen xấu (muốn bỏ)</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={focus} onChange={(e) => setFocus(e.target.checked)} style={{ width: "auto" }} />
          <span>Đặt làm việc Focus của hôm nay</span>
        </label>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>
          {habit.goal_title ? `Mục tiêu: ${habit.goal_title} · ` : ""}Chuỗi {habit.current_streak} · Dài nhất {habit.longest_streak}
        </div>
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
        <button className="linkbtn" style={{ marginTop: 12, display: "block", marginInline: "auto" }} onClick={() => onClose(false)}>Hủy</button>
        <div className="err">{err}</div>
        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        {!confirmDel ? (
          <button className="linkbtn" style={{ color: "#d64545", display: "block", marginInline: "auto" }} onClick={() => setConfirmDel(true)}>Xóa thói quen này</button>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>Xóa (lưu trữ) thói quen này?</div>
            <button className="btn" style={{ background: "#d64545", boxShadow: "none" }} onClick={del} disabled={busy}>Xác nhận xóa</button>
            <button className="linkbtn" style={{ marginTop: 10, display: "block", marginInline: "auto" }} onClick={() => setConfirmDel(false)}>Không</button>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------- Achievements ---------------- */
function YearReview({ token, onBack }: { token: string; onBack: () => void }) {
  const [y, setY] = useState<any>(null);
  useEffect(() => { apiCall("/stats/year-review", { token }).then((r) => setY(r.json)); }, [token]);
  if (!y) return <div className="center-screen">Đang tổng kết…</div>;
  const monthName = y.best_month ? (() => { const [yr, mo] = y.best_month.month.split("-"); return `Tháng ${parseInt(mo)}/${yr}`; })() : "—";
  return (
    <>
      <div className="section-title">Xem lại năm 🎉</div>
      <div className="yr-hero">
        <div className="big">{y.total_completions}</div>
        <div className="lbl">lượt hoàn thành trong 1 năm qua</div>
      </div>
      <div className="yr-grid">
        <div className="yr-cell"><b>{y.active_days}</b><small>ngày có hoạt động</small></div>
        <div className="yr-cell"><b>{y.perfect_days}</b><small>ngày hoàn hảo</small></div>
        <div className="yr-cell"><b>{y.longest_streak}</b><small>chuỗi dài nhất</small></div>
        <div className="yr-cell"><b>{y.habits_count}</b><small>thói quen</small></div>
      </div>
      {y.best_habit && (
        <div className="recap" style={{ marginTop: 12 }}>
          <span className="hicon" style={{ background: tint(y.best_habit.color) }}>{y.best_habit.icon}</span>
          <div className="rl"><b>Thói quen bền nhất</b><small>{y.best_habit.name} · {y.best_habit.count} lượt</small></div>
        </div>
      )}
      <div className="recap" style={{ marginTop: 10 }}>
        <div className="num" style={{ color: "var(--ember)", fontSize: 18 }}>🏆</div>
        <div className="rl"><b>Tháng bùng nổ nhất</b><small>{monthName}{y.best_month ? ` · ${y.best_month.count} lượt` : ""}</small></div>
      </div>
      <button className="btn ghost" style={{ marginTop: 16 }} onClick={onBack}>← Quay lại</button>
    </>
  );
}

function AwardsTab({ token }: { token: string }) {
  const [a, setA] = useState<any>(null);
  const [showYear, setShowYear] = useState(false);
  useEffect(() => { apiCall("/achievements", { token }).then((r) => setA(r.json)); }, [token]);

  if (showYear) return <YearReview token={token} onBack={() => setShowYear(false)} />;
  if (!a) return <div className="center-screen">Đang tải…</div>;
  const pct = a.xp_to_next ? Math.min(100, (a.xp_in_level / a.xp_to_next) * 100) : 100;

  return (
    <>
      <div className="section-title">Thành tựu</div>
      <button className="btn" style={{ marginBottom: 14 }} onClick={() => setShowYear(true)}>🎉 Xem lại năm</button>
      <div className="level-card">
        <div className="level-badge"><small>LEVEL</small>{a.level}</div>
        <div className="level-info">
          <b>Cấp {a.level}</b>
          <div className="xpbar"><i style={{ width: `${pct}%` }} /></div>
          <small>{a.xp_in_level}/{a.xp_to_next} XP → cấp {a.level + 1} · tổng {a.total_completions} lượt</small>
        </div>
      </div>
      <div className="award-summary">Đã mở khóa <b>{a.unlocked_count}/{a.total_badges}</b> huy hiệu</div>
      <div className="badge-grid">
        {a.badges.map((b: any) => (
          <div className={`badge${b.unlocked ? "" : " locked"}`} key={b.key}>
            {b.unlocked && <span className="check-tick">✓</span>}
            <div className="bic">{b.icon}</div>
            <b>{b.title}</b>
            <div className="bd">{b.desc}</div>
            {!b.unlocked && (
              <>
                <div className="bprog"><i style={{ width: `${(b.value / b.target) * 100}%` }} /></div>
                <div className="bd" style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{b.value}/{b.target}</div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- Stats (optimized) ---------------- */
const WDN = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const isoOf = (d: Date) => d.toLocaleDateString("en-CA");
const isGood = (s: string) => s === "completed" || s === "partial";
const isActed = (s: string) => s === "completed" || s === "partial" || s === "missed";

function MonthCalendar({ map, color }: { map: Map<string, string>; color: string }) {
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const y = ref.getFullYear(), m = ref.getMonth();
  const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells: Array<{ day?: number; st?: string }> = [];
  for (let i = 0; i < startDow; i++) cells.push({});
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, st: map.get(new Date(y, m, d).toLocaleDateString("en-CA")) });
  const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
  return (
    <>
      <div className="cal-head">
        <button onClick={() => setRef(new Date(y, m - 1, 1))} aria-label="Tháng trước">‹</button>
        <b>Tháng {m + 1}/{y}</b>
        <button onClick={() => setRef(new Date(y, m + 1, 1))} aria-label="Tháng sau">›</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div className="cal-dow" key={d}>{d}</div>)}
        {cells.map((c, i) => {
          if (!c.day) return <div className="cal-cell empty" key={i} />;
          const done = c.st === "completed" || c.st === "partial";
          const cls = done ? "done" : c.st === "missed" ? "missed" : c.st === "frozen" ? "froze" : "";
          return <div className={`cal-cell ${cls}`} key={i} style={done ? { background: color } : undefined}>{c.day}</div>;
        })}
      </div>
    </>
  );
}

function MoodCorrelation({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => { apiCall("/stats/mood", { token }).then((r) => setD(r.json)); }, [token]);
  if (!d || d.entries === 0) return null;
  return (
    <>
      <div className="block-title">Tâm trạng ↔ hoàn thành</div>
      <div className="corr">
        <div className="c"><b>{d.good_mood_rate ?? "—"}%</b><small>ngày tâm trạng tốt 🙂😄</small></div>
        <div className="c"><b>{d.low_mood_rate ?? "—"}%</b><small>ngày tâm trạng thấp 😞😕</small></div>
      </div>
      <div className="best-day" style={{ marginTop: 10 }}>
        {d.good_mood_rate != null && d.low_mood_rate != null
          ? (d.good_mood_rate >= d.low_mood_rate
              ? <>Khi vui, bạn hoàn thành nhiều hơn <b>{d.good_mood_rate - d.low_mood_rate}%</b> so với ngày buồn.</>
              : <>Thú vị: ngày tâm trạng thấp bạn lại chăm hơn <b>{d.low_mood_rate - d.good_mood_rate}%</b>.</>)
          : "Ghi tâm trạng vài ngày để thấy tương quan."}
      </div>
    </>
  );
}

function MoodStats({ token }: { token: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { apiCall(`/mood?from=${daysAgoLocal(364)}&to=${todayLocal()}`, { token }).then((r) => setRows(r.json?.data || [])); }, [token]);

  if (rows === null) return <div className="center-screen">Đang tải…</div>;
  if (rows.length === 0) return <div className="ov-note">Chưa có dữ liệu tâm trạng. Ghi tâm trạng ở tab Hôm nay để xem thống kê.</div>;

  const moodByDate = new Map<string, number>();
  for (const r of rows) moodByDate.set(String(r.loggedDate).slice(0, 10), r.mood);
  const avg = rows.reduce((a, r) => a + r.mood, 0) / rows.length;
  const avgMeta = moodMeta(Math.round(avg));
  const dist = [1, 2, 3, 4, 5].map((v) => ({ v, count: rows.filter((r) => r.mood === v).length }));
  const maxCount = Math.max(1, ...dist.map((d) => d.count));

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const start = new Date(today0); start.setDate(start.getDate() - 364); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const cells: Array<{ k: string; mood?: number }> = [];
  for (let d = new Date(start); d <= today0; d.setDate(d.getDate() + 1)) { const k = isoOf(d); cells.push({ k, mood: moodByDate.get(k) }); }
  const journal = [...rows].reverse().filter((r) => r.note).slice(0, 12);

  return (
    <>
      <div className="mood-avg">
        <div className="big-face" style={{ background: `color-mix(in srgb, ${avgMeta.color} 18%, var(--panel-2))` }}>{avgMeta.emoji}</div>
        <div className="ma"><b>Trung bình: {avgMeta.label} · {avg.toFixed(1)}/5</b><small>{rows.length} ngày đã ghi tâm trạng</small></div>
      </div>

      <div className="block-title">Phân bố tâm trạng</div>
      <div className="mdist">
        {dist.slice().reverse().map((d) => { const m = moodMeta(d.v); return (
          <div className="mrow" key={d.v}>
            <span className="em">{m.emoji}</span>
            <div className="bar"><i style={{ width: `${(d.count / maxCount) * 100}%`, background: m.color }} /></div>
            <span className="ct">{d.count}</span>
          </div>
        ); })}
      </div>

      <div className="block-title">1 năm tâm trạng · Year in Pixels</div>
      <div className="hy-wrap">
        <div className="pixels">
          {cells.map((c) => { const m = c.mood ? moodMeta(c.mood) : null; return <i key={c.k} style={m ? { background: m.color, borderColor: "transparent" } : undefined} title={`${c.k}${m ? ": " + m.label : ""}`} />; })}
        </div>
      </div>

      {journal.length > 0 && (
        <>
          <div className="block-title">Nhật ký tâm trạng</div>
          <div className="mjournal">
            {journal.map((r, i) => { const m = moodMeta(r.mood); return (
              <div className="mj-item" key={i}>
                <span className="mem">{m.emoji}</span>
                <div className="mtx"><div className="md">{String(r.loggedDate).slice(0, 10)} · {m.label}</div><div className="mn">{r.note}</div></div>
              </div>
            ); })}
          </div>
        </>
      )}
    </>
  );
}

function StatsTab({ token }: { token: string }) {
  const [mode, setMode] = useState<"overview" | "single" | "mood">("overview");
  return (
    <>
      <div className="section-title">Thống kê</div>
      <div className="seg2">
        <button className={mode === "overview" ? "on" : ""} onClick={() => setMode("overview")}>Tổng quan</button>
        <button className={mode === "single" ? "on" : ""} onClick={() => setMode("single")}>Thói quen</button>
        <button className={mode === "mood" ? "on" : ""} onClick={() => setMode("mood")}>Tâm trạng</button>
      </div>
      {mode === "overview" && <OverviewStats token={token} />}
      {mode === "single" && <SingleStats token={token} />}
      {mode === "mood" && <MoodStats token={token} />}
      {mode !== "mood" && <ReflectionCard token={token} />}
    </>
  );
}

function OverviewStats({ token }: { token: string }) {
  const [ov, setOv] = useState<any>(null);
  useEffect(() => { apiCall("/stats/overview?days=364", { token }).then((r) => setOv(r.json)); }, [token]);

  if (!ov) return <div className="center-screen">Đang tải…</div>;
  if (ov.active_habits === 0) return <div className="ov-note">Chưa có thói quen nào để thống kê.</div>;

  const color = "#ea580c";
  const trend = ov.this_week_done - ov.last_week_done;
  const bestWd = ov.weekday.some((r: number) => r > 0) ? ov.weekday.indexOf(Math.max(...ov.weekday)) : -1;
  const lvlBg = (lvl: number) => lvl === 3 ? color : lvl === 2 ? `color-mix(in srgb, ${color} 60%, var(--panel-2))` : lvl === 1 ? `color-mix(in srgb, ${color} 30%, var(--panel-2))` : undefined;

  // heatmap gộp: cường độ = done/due mỗi ngày; canh thứ Hai
  const byDate = new Map<string, { due: number; done: number }>();
  for (const d of ov.days) byDate.set(d.date, { due: d.due, done: d.done });
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const start = new Date(today0); start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const cells: Array<{ k: string; lvl: number; due: number; done: number }> = [];
  for (let d = new Date(start); d <= today0; d.setDate(d.getDate() + 1)) {
    const k = isoOf(d);
    const rec = byDate.get(k) || { due: 0, done: 0 };
    let lvl = 0;
    if (rec.due > 0 && rec.done > 0) { const r = rec.done / rec.due; lvl = r >= 1 ? 3 : r >= 0.5 ? 2 : 1; }
    cells.push({ k, lvl, due: rec.due, done: rec.done });
  }

  return (
    <>
      <div className="ov-note">Gộp tất cả {ov.active_habits} thói quen đang hoạt động.</div>
      <div className="stat-grid">
        <div className="stat ember"><b>{ov.best_current_streak}</b><small><span className="cap"><Flame size={11} /> Chuỗi tốt nhất</span></small></div>
        <div className="stat"><b>{ov.best_longest_streak}</b><small>Dài nhất mọi thời</small></div>
        <div className="stat"><b>{ov.rate_30d}%</b><small>Tỉ lệ đạt (30 ngày)</small></div>
        <div className="stat"><b>{ov.total_completions}</b><small>Tổng lượt (1 năm)</small></div>
      </div>

      <div className="block-title">Tuần này — mọi thói quen</div>
      <div className="recap">
        <div className="num" style={{ color }}>{ov.this_week_done}</div>
        <div className="rl"><b>{ov.this_week_done} lượt hoàn thành</b><small>Tuần trước: {ov.last_week_done} lượt</small></div>
        <span className={`trend ${trend > 0 ? "up" : trend < 0 ? "down" : "flat"}`}>{trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : "—"}</span>
      </div>

      <div className="block-title">Ngày mạnh nhất trong tuần</div>
      <div className="wbars">
        {ov.weekday.map((r: number, i: number) => (
          <div className={`wbar${i === bestWd ? " best" : ""}`} key={i}>
            <div className="pc">{r > 0 ? r + "%" : ""}</div>
            <div className="track"><div className="fill" style={{ height: `${r}%`, background: i === bestWd ? color : "var(--line-strong)" }} /></div>
            <div className="lbl">{WDN[i]}</div>
          </div>
        ))}
      </div>
      {bestWd >= 0 && <div className="best-day">Cả nhóm làm tốt nhất vào <b>{WDN[bestWd] === "CN" ? "Chủ Nhật" : "Thứ " + WDN[bestWd].slice(1)}</b> ({ov.weekday[bestWd]}%).</div>}

      <div className="block-title">1 năm qua — đậm = nhiều thói quen hoàn thành/ngày</div>
      <div className="hy-wrap">
        <div className="hy">
          {cells.map((c) => <i key={c.k} className="hc" style={c.lvl ? { background: lvlBg(c.lvl), borderColor: "transparent" } : undefined} title={`${c.k}: ${c.done}/${c.due}`} />)}
        </div>
      </div>
      <div className="hy-legend">
        Ít <i /><i style={{ background: lvlBg(1), borderColor: "transparent" }} /><i style={{ background: lvlBg(2), borderColor: "transparent" }} /><i style={{ background: color, borderColor: "transparent" }} /> Nhiều
      </div>

      <MoodCorrelation token={token} />
    </>
  );
}

function SingleStats({ token }: { token: string }) {
  const [habits, setHabits] = useState<any[]>([]);
  const [sel, setSel] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => { apiCall("/habits", { token }).then((r) => { const hs = r.json?.data ?? []; setHabits(hs); if (hs[0]) setSel(String(hs[0].id)); }); }, [token]);

  useEffect(() => {
    if (!sel) return;
    (async () => {
      const d = await apiCall(`/habits/${sel}`, { token });
      setDetail(d.json);
      const logs = await apiCall(`/habits/${sel}/logs?from=${daysAgoLocal(364)}&to=${todayLocal()}`, { token });
      const m = new Map<string, string>();
      for (const l of logs.json?.data ?? []) m.set(String(l.loggedDate).slice(0, 10), l.status);
      setMap(m);
    })();
  }, [sel, token]);

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const start = new Date(today0); start.setDate(start.getDate() - 364);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days: Array<{ k: string; st: string; wd: number }> = [];
  for (let d = new Date(start); d <= today0; d.setDate(d.getDate() + 1)) {
    const k = isoOf(d);
    days.push({ k, st: map.get(k) || "none", wd: (d.getDay() + 6) % 7 });
  }

  const color = detail?.color || "#ea580c";
  const yearDone = days.filter((x) => isGood(x.st)).length;
  const last30 = days.slice(-30);
  const a30 = last30.filter((x) => isActed(x.st)).length;
  const rate30 = a30 ? Math.round(last30.filter((x) => isGood(x.st)).length / a30 * 100) : 0;

  const wd = Array.from({ length: 7 }, () => ({ g: 0, a: 0 }));
  for (const x of days) if (isActed(x.st)) { wd[x.wd].a++; if (isGood(x.st)) wd[x.wd].g++; }
  const wdRate = wd.map((w) => (w.a ? Math.round(w.g / w.a * 100) : 0));
  const bestWd = wdRate.some((r) => r > 0) ? wdRate.indexOf(Math.max(...wdRate)) : -1;

  const thisWeek = days.slice(-7).filter((x) => isGood(x.st)).length;
  const lastWeek = days.slice(-14, -7).filter((x) => isGood(x.st)).length;
  const trend = thisWeek - lastWeek;

  return (
    <>
      <div className="picker">
        {habits.map((h) => <button key={h.id} className={String(h.id) === sel ? "on" : ""} onClick={() => setSel(String(h.id))}>{h.icon} {h.name}</button>)}
      </div>

      {detail && (
        <>
          <div className="stat-grid">
            <div className="stat ember"><b>{detail.current_streak}</b><small><span className="cap"><Flame size={11} /> Chuỗi hiện tại</span></small></div>
            <div className="stat"><b>{detail.longest_streak}</b><small>Chuỗi dài nhất</small></div>
            <div className="stat"><b>{rate30}%</b><small>Tỉ lệ đạt (30 ngày)</small></div>
            <div className="stat"><b>{yearDone}</b><small>Tổng lượt (1 năm)</small></div>
          </div>

          <div className="block-title">Tuần này</div>
          <div className="recap">
            <div className="num" style={{ color }}>{thisWeek}</div>
            <div className="rl"><b>{thisWeek} lượt hoàn thành</b><small>Tuần trước: {lastWeek} lượt</small></div>
            <span className={`trend ${trend > 0 ? "up" : trend < 0 ? "down" : "flat"}`}>
              {trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : "—"}
            </span>
          </div>

          <div className="block-title">Ngày mạnh nhất trong tuần</div>
          <div className="wbars">
            {wdRate.map((r, i) => (
              <div className={`wbar${i === bestWd ? " best" : ""}`} key={i}>
                <div className="pc">{r > 0 ? r + "%" : ""}</div>
                <div className="track"><div className="fill" style={{ height: `${r}%`, background: i === bestWd ? color : "var(--line-strong)" }} /></div>
                <div className="lbl">{WDN[i]}</div>
              </div>
            ))}
          </div>
          {bestWd >= 0 && <div className="best-day">Bạn làm tốt nhất vào <b>{WDN[bestWd] === "CN" ? "Chủ Nhật" : "Thứ " + WDN[bestWd].slice(1)}</b> ({wdRate[bestWd]}%).</div>}

          <div className="block-title">1 năm qua</div>
          <div className="hy-wrap">
            <div className="hy">
              {days.map((x) => {
                const done = x.st === "completed";
                const partial = x.st === "partial";
                const cls = x.st === "missed" ? "missed" : x.st === "frozen" ? "froze" : partial ? "partial" : "";
                const style = done || partial ? { background: color, borderColor: "transparent" as const } : undefined;
                return <i key={x.k} className={`hc ${cls}`} style={style} title={`${x.k}: ${x.st}`} />;
              })}
            </div>
          </div>
          <div className="hy-legend">
            Ít <i /><i style={{ background: color, opacity: 0.55, borderColor: "transparent" }} /><i style={{ background: color, borderColor: "transparent" }} /> Nhiều
            <i style={{ background: "var(--ice)", borderColor: "transparent", marginLeft: 6 }} /> ❄
          </div>

          <div className="block-title">Lịch tháng</div>
          <MonthCalendar map={map} color={color} />
        </>
      )}
    </>
  );
}

function fmtWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const end = new Date(d); end.setDate(end.getDate() + 6);
  const f = (x: Date) => `${x.getDate()}/${x.getMonth() + 1}`;
  return `${f(d)} – ${f(end)}`;
}

function ReflectionCard({ token }: { token: string }) {
  const week = weekStartLocal();
  const [blocker, setBlocker] = useState("");
  const [adjust, setAdjust] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [past, setPast] = useState<any[] | null>(null);

  const loadPast = useCallback(async () => {
    const r = await apiCall("/reflections", { token });
    const rows = (r.json?.data ?? []).filter((x: any) => x.goalId == null);
    const cur = rows.find((x: any) => String(x.weekStart).slice(0, 10) === week);
    if (cur) { setBlocker(cur.blockerText ?? ""); setAdjust(cur.adjustmentText ?? ""); }
    setPast(rows.filter((x: any) => String(x.weekStart).slice(0, 10) !== week));
  }, [token, week]);

  useEffect(() => { loadPast(); }, [loadPast]);

  async function save() {
    setBusy(true); setSaved(false);
    const r = await apiCall("/reflections", { method: "POST", token, body: { week_start: week, blocker_text: blocker, adjustment_text: adjust } });
    setBusy(false);
    if (r.status === 200 || r.status === 201) { setSaved(true); setTimeout(() => setSaved(false), 2500); loadPast(); }
  }

  return (
    <>
      <div className="reflect-head"><span className="t">Nhìn lại tuần</span><span className="w">{fmtWeek(week)}</span></div>
      <div className="card">
        <label>Điều gì cản trở bạn tuần qua?</label>
        <textarea value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="VD: Tối nào cũng bận, hay quên…" />
        <label>Điều chỉnh micro-habit thế nào cho dễ hơn?</label>
        <textarea value={adjust} onChange={(e) => setAdjust(e.target.value)} placeholder="VD: Dời sang buổi sáng, giảm còn 3 phút…" />
        <button className="btn" onClick={save} disabled={busy}>{busy ? "Đang lưu…" : "Lưu & lên kế hoạch tuần tới"}</button>
        {saved && <div style={{ textAlign: "center", marginTop: 10 }}><span className="saved-tag">✓ Đã lưu</span></div>}
      </div>

      <div className="block-title">Các tuần trước</div>
      {past === null ? (
        <div className="past-empty">Đang tải…</div>
      ) : past.length === 0 ? (
        <div className="past-empty">Chưa có nhật ký tuần nào trước đây. Mỗi Chủ Nhật hãy dành 1 phút nhìn lại.</div>
      ) : (
        <div className="past-list">
          {past.slice(0, 8).map((p) => (
            <div className="past-item" key={p.id}>
              <div className="pw">Tuần {fmtWeek(String(p.weekStart).slice(0, 10))}</div>
              {p.blockerText && <div className="pq"><span className="k">Cản trở:</span> {p.blockerText}</div>}
              {p.adjustmentText && <div className="pq"><span className="k">Điều chỉnh:</span> {p.adjustmentText}</div>}
              {!p.blockerText && !p.adjustmentText && <div className="pq" style={{ color: "var(--faint)" }}>—</div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
