"use client";

import { useCallback, useEffect, useState } from "react";

const API = "/api/v1";
const TOKEN_KEY = "grit_token";

const EMOJIS = ["🔥", "💧", "📖", "🏃", "🧘", "💪", "🥗", "😴", "💊", "🧠", "🎯", "✍️", "🌱", "☀️", "💰", "🎸"];
const COLORS = ["#ea580c", "#e11d48", "#db2777", "#7c3aed", "#2563eb", "#0891b2", "#059669", "#65a30d", "#ca8a04", "#475569"];

function todayLocal(): string { return new Date().toLocaleDateString("en-CA"); }
function daysAgoLocal(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("en-CA"); }
function weekStartLocal(): string { const d = new Date(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d.toLocaleDateString("en-CA"); }
function tint(hex: string, pct = 16) { return `color-mix(in srgb, ${hex} ${pct}%, var(--panel))`; }

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
  const [tab, setTab] = useState<"today" | "habits" | "stats">("today");

  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); }, []);

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
        <span className="brand-mark"><Flame size={22} /></span>
        <b>Grit</b>
        {me && <span className="who">{me.email}</span>}
        {me && <button className="linkbtn" onClick={doLogout} style={{ marginLeft: 8 }}>Thoát</button>}
      </div>

      {view === "loading" && <div className="center-screen">Đang tải…</div>}
      {view === "auth" && <AuthView onAuthed={(tk) => { setToken(tk); try { localStorage.setItem(TOKEN_KEY, tk); } catch {} setView("loading"); loadState(tk); }} />}
      {view === "onboarding" && token && <OnboardingView token={token} onDone={() => { setView("loading"); loadState(token); }} />}

      {view === "app" && token && (
        <>
          <div className="tabcontent">
            {tab === "today" && <TodayTab token={token} goHabits={() => setTab("habits")} />}
            {tab === "habits" && <HabitsTab token={token} />}
            {tab === "stats" && <StatsTab token={token} />}
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
          </nav>
        </>
      )}
    </main>
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
  const [goal, setGoal] = useState("");
  const [habit, setHabit] = useState("");
  const [icon, setIcon] = useState("🔥");
  const [color, setColor] = useState(COLORS[0]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!goal.trim() || !habit.trim()) { setErr("Nhập cả mục tiêu và việc hôm nay."); return; }
    setErr(""); setBusy(true);
    const g = await apiCall("/goals", { method: "POST", token, body: { title: goal } });
    if (g.status !== 201) { setBusy(false); setErr("Lỗi tạo mục tiêu."); return; }
    const h = await apiCall("/habits", {
      method: "POST", token,
      body: { goal_id: g.json.id, name: habit, type: "checkbox", is_focus: true, icon, color, schedule: { schedule_type: "daily", weekdays_mask: 127, effective_from: todayLocal() } },
    });
    setBusy(false);
    if (h.status !== 201) { setErr("Lỗi tạo thói quen."); return; }
    onDone();
  }

  return (
    <>
      <h1>Mục tiêu của bạn</h1>
      <p className="sub">Nhập điều lớn lao, rồi chia thành một việc siêu nhỏ cho hôm nay.</p>
      <div className="card">
        <label>Mục tiêu lớn</label>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="VD: Chạy 5km" />
        <label>Việc hôm nay (siêu nhỏ)</label>
        <input value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="VD: Xỏ giày & đi bộ 5 phút" />
        <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} />
        <button className="btn" onClick={create} disabled={busy}>{busy ? "Đang tạo…" : "Bắt đầu"}</button>
        <div className="err">{err}</div>
      </div>
      <div className="footnote">Chỉ 1 việc/ngày — chống tê liệt, dễ bắt đầu.</div>
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
function TodayTab({ token, goHabits }: { token: string; goHabits: () => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiCall("/dashboard/today", { token });
    setItems((r.json?.items ?? []).filter((it: any) => it.today_status !== "not_due"));
  }, [token]);
  useEffect(() => { load(); }, [load]);

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

  // nhóm theo mục tiêu
  const groups: Record<string, any[]> = {};
  for (const it of items) { const k = it.goal_title || "Khác"; (groups[k] ||= []).push(it); }

  return (
    <div className="today-top">
      <div className="hello">Hôm nay</div>
      <div className="date">{new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })}</div>

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

          {Object.entries(groups).map(([g, hs]) => (
            <div key={g}>
              <div className="group-title">{g}</div>
              <div className="hlist">
                {hs.map((it) => {
                  const done = it.today_status === "completed" || it.today_status === "partial";
                  const frozen = it.today_status === "frozen";
                  return (
                    <div className={`hrow${done ? " is-done" : ""}`} key={it.habit_id}>
                      <span className="hicon" style={{ background: tint(it.color) }}>{it.icon}</span>
                      <div className="hbody">
                        <b>{it.name}</b>
                        <small><span className="st">🔥{it.current_streak}</span>{it.type !== "checkbox" && it.target_value ? ` · ${it.target_value}${it.type === "timer" ? "s" : " " + (it.target_unit || "")}` : ""}</small>
                      </div>
                      {frozen ? (
                        <span className="check frozen" title="Được Freeze bảo vệ">❄</span>
                      ) : (
                        <button className={`check${done ? " done" : ""}`} style={done ? { background: it.color, borderColor: it.color } : undefined}
                          onClick={() => toggle(it)} disabled={busyId === String(it.habit_id)} aria-label={done ? "Bỏ đánh dấu" : "Hoàn thành"}>
                          <CheckMark />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
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
function HabitsTab({ token }: { token: string }) {
  const [items, setItems] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

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
    const h = await apiCall("/habits", { method: "POST", token, body: { goal_id: gid, name, type, is_focus: false, icon, color, weekly_miss_allowance: allow, schedule } });
    setBusy(false);
    if (h.status !== 201) { setErr(h.json?.error?.message || "Lỗi tạo thói quen."); return; }
    onClose(true);
  }

  return (
    <>
      <div className="section-title">Thêm thói quen</div>
      <div className="card">
        <label>Thuộc mục tiêu</label>
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {goals.map((g) => <option key={g.id} value={String(g.id)}>{g.title}</option>)}
          <option value="new">＋ Mục tiêu mới…</option>
        </select>
        {goalId === "new" && (<><label>Tên mục tiêu mới</label><input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="VD: Đọc sách" /></>)}
        <label>Tên thói quen</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: Đọc 1 trang" />
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
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiCall(`/habits/${id}`, { token }).then((r) => {
      if (r.status === 200) { setHabit(r.json); setName(r.json.name); setFocus(!!r.json.is_focus); setIcon(r.json.icon || "🔥"); setColor(r.json.color || COLORS[0]); setAllow(r.json.weekly_miss_allowance ?? 0); }
    });
  }, [id, token]);

  async function save() {
    if (!name.trim()) { setErr("Tên không được trống."); return; }
    setErr(""); setBusy(true);
    const r = await apiCall(`/habits/${id}`, { method: "PATCH", token, body: { name, is_focus: focus, icon, color, weekly_miss_allowance: allow } });
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

/* ---------------- Stats (optimized) ---------------- */
const WDN = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const isoOf = (d: Date) => d.toLocaleDateString("en-CA");
const isGood = (s: string) => s === "completed" || s === "partial";
const isActed = (s: string) => s === "completed" || s === "partial" || s === "missed";

function StatsTab({ token }: { token: string }) {
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

  // Dựng chuỗi ngày 1 năm, canh về thứ Hai để heatmap thẳng cột-tuần.
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

  // hiệu suất theo thứ
  const wd = Array.from({ length: 7 }, () => ({ g: 0, a: 0 }));
  for (const x of days) if (isActed(x.st)) { wd[x.wd].a++; if (isGood(x.st)) wd[x.wd].g++; }
  const wdRate = wd.map((w) => (w.a ? Math.round(w.g / w.a * 100) : 0));
  const bestWd = wdRate.some((r) => r > 0) ? wdRate.indexOf(Math.max(...wdRate)) : -1;

  // weekly recap
  const thisWeek = days.slice(-7).filter((x) => isGood(x.st)).length;
  const lastWeek = days.slice(-14, -7).filter((x) => isGood(x.st)).length;
  const trend = thisWeek - lastWeek;

  return (
    <>
      <div className="section-title">Thống kê</div>
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
        </>
      )}

      <ReflectionCard token={token} />
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
