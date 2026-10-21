/* ===========================================================
   MUNGIBERRI TXOKO — Herriko Elkargunea
   Aplikazioaren logika (Supabase + Vanilla JS)
   =========================================================== */
"use strict";

/* ---------- Hizkuntza: euskara ---------- */
const HILABETEAK = ["Urtarrila","Otsaila","Martxoa","Apirila","Maiatza","Ekaina",
  "Uztaila","Abuztua","Iraila","Urria","Azaroa","Abendua"];
const HILABETE_GEN = ["urtarrilaren","otsailaren","martxoaren","apirilaren","maiatzaren","ekainaren",
  "uztailaren","abuztuaren","irailaren","urriaren","azaroaren","abenduaren"];
const ASTEGUNAK = ["astelehena","asteartea","asteazkena","osteguna","ostirala","larunbata","igandea"];
const AFOROA = 25;

/* ---------- Supabase bezeroa ---------- */
let db = null;
const cfg = window.TXOKO_CONFIG || {};
const configOk = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("HEMEN") &&
                 cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("HEMEN");
if (configOk) {
  db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      flowType: "implicit",        // pasahitza berrezartzeko esteka hash bidez itzul dadin
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

/* ---------- Egoera ---------- */
const state = {
  user: null,          // auth erabiltzailea
  profile: null,       // { id, full_name, role, email }
  profiles: {},        // id -> profila (cache)
  viewDate: new Date(),// erakusten den hilabetea
  monthRes: [],        // hilabeteko erreserbak
  blocked: new Set(),  // blokeatutako egunak (ISO)
};

/* ---------- Lagungarriak ---------- */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const hhmm = (t) => (t || "").slice(0, 5);
const todayIso = () => isoOf(new Date());

function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = (dt.getDay() + 6) % 7; // astelehena = 0
  return `${y}ko ${HILABETE_GEN[m-1]} ${d}a, ${ASTEGUNAK[wd]}`;
}

function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (isError ? " error" : "");
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3400);
}

// Elkargunearen (elkartearen) erabiltzailea den ala ez — profiles.elkargune zutabea
function isElk(userId) {
  const p = state.profiles[userId];
  return !!(p && p.elkargune);
}

function nameOf(userId) {
  const p = state.profiles[userId];
  return p ? (p.full_name || p.email) : "—";
}

// Aldi berean dauden gehieneko lagunak (sweep-line)
function maxConcurrent(list) {
  if (!list.length) return 0;
  const starts = [...new Set(list.map(r => hhmm(r.start_time)))];
  let mx = 0;
  for (const t of starts) {
    let s = 0;
    for (const r of list) {
      // Elkargunearen erreserbak aforo osoa hartzen du bere orduetan
      if (hhmm(r.start_time) <= t && hhmm(r.end_time) > t) s += isElk(r.user_id) ? AFOROA : r.num_people;
    }
    if (s > mx) mx = s;
  }
  return mx;
}

function mapError(msg) {
  msg = String(msg || "");
  if (msg.includes("AFOROA_GAINDITUA"))
    return `Ezin da erreserba egin: une horretan ${AFOROA} lagun baino gehiago egongo lirateke txokoan. Aldatu ordua edo pertsona kopurua.`;
  if (msg.includes("EGUN_BLOKEATUA"))
    return "Egun hori blokeatuta dago. Ezin da erreserbarik egin.";
  if (msg.includes("ordu_zuzena"))
    return "Irteteko orduak iristeko ordua baino beranduagokoa izan behar du.";
  if (msg.includes("num_people"))
    return `Pertsona kopuruak 1 eta ${AFOROA} artekoa izan behar du.`;
  if (msg.includes("DATA_IRAGANA"))
    return "Ezin da iraganeko egun baterako erreserbarik egin.";
  if (msg.includes("ELKARGUNE_ORDUAK"))
    return "Ordu horietan Elkargunearen erreserba bat dago eta txokoa beteta dago. Aukeratu beste ordu bat.";
  if (msg.includes("ELKARGUNE_GAINJARRIA"))
    return "Ordu horietan beste erreserba batzuk daude. Elkargunearen erreserbak txoko osoa hartzen du: aldatu edo ezabatu lehenik beste erreserba horiek.";
  if (msg.includes("BAIMENIK_EZ"))
    return "Ez duzu baimenik aldaketa hori egiteko.";
  if (msg.toLowerCase().includes("invalid login"))
    return "Emaila edo pasahitza ez da zuzena.";
  return msg || "Errore bat gertatu da.";
}

/* ===========================================================
   AUTENTIFIKAZIOA
   =========================================================== */
async function loadProfile() {
  const { data, error } = await db.from("profiles").select("*").eq("id", state.user.id).single();
  if (error) throw error;
  state.profile = data;
}

async function enterApp() {
  await loadProfile();
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  refreshGreeting();
  const isAdmin = state.profile.role === "admin";
  $("nav-admin").hidden = !isAdmin;
  switchView("calendar");          // beti egutegian hasi (ikuspegia berrezarri)
  await loadProfiles();
  await loadMonth();
}

function refreshGreeting() {
  const n = (state.profile.full_name || state.profile.email).trim();
  $("hi-user").textContent = "Kaixo, " + (n.split(" ")[0] || n);
}

function showLogin() {
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  showLoginForm("login");
  // Egoera eta ikuspegiak garbitu (aurreko saioko daturik ez erakusteko)
  $("nav-admin").hidden = true;
  switchView("calendar");
  ["#members-table tbody", "#blocked-table tbody", "#history-table tbody"].forEach(sel => {
    const t = document.querySelector(sel); if (t) t.innerHTML = "";
  });
  $("cal-grid").innerHTML = "";
}

// Login txartelaren azpi-formularioak erakutsi: "login" | "forgot" | "recovery"
function showLoginForm(which) {
  $("login-form").hidden    = which !== "login";
  $("forgot-link").hidden   = which !== "login";
  $("forgot-form").hidden   = which !== "forgot";
  $("recovery-form").hidden = which !== "recovery";
  const foot = document.querySelector(".login-foot");
  if (foot) foot.hidden = which !== "login";
  ["login-error", "forgot-error", "forgot-ok", "rec-error"].forEach(id => { $(id).hidden = true; });
}

/* ---- Pasahitza ahaztu / berrezarri ---- */
$("forgot-link").addEventListener("click", () => showLoginForm("forgot"));
$("forgot-back").addEventListener("click", () => showLoginForm("login"));

$("forgot-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("forgot-error").hidden = true; $("forgot-ok").hidden = true;
  if (!configOk) { $("forgot-error").textContent = "Webgunea ez dago konfiguratuta."; $("forgot-error").hidden = false; return; }
  const email = $("forgot-email").value.trim();
  const btn = $("forgot-btn"); btn.disabled = true; btn.textContent = "Bidaltzen...";
  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
    $("forgot-ok").textContent = "Berrezartzeko esteka bidali dugu helbide horretara (begiratu spam karpeta ere). Esteka 1 orduz baliozkoa da.";
    $("forgot-ok").hidden = false;
  } catch (ex) {
    $("forgot-error").textContent = mapError(ex.message); $("forgot-error").hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Berrezartzeko esteka bidali";
  }
});

$("recovery-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("rec-error").hidden = true;
  const np = $("rec-new").value, rp = $("rec-rep").value;
  if (np.length < 6) { $("rec-error").textContent = "Pasahitzak gutxienez 6 karaktere behar ditu."; $("rec-error").hidden = false; return; }
  if (np !== rp) { $("rec-error").textContent = "Pasahitzak ez datoz bat."; $("rec-error").hidden = false; return; }
  const btn = $("rec-btn"); btn.disabled = true; btn.textContent = "Gordetzen...";
  try {
    const { error } = await db.auth.updateUser({ password: np });
    if (error) throw error;
    await db.auth.signOut();
    history.replaceState(null, "", window.location.pathname);
    showLoginForm("login");
    toast("Pasahitza aldatu da. Sartu orain pasahitz berriarekin.");
  } catch (ex) {
    $("rec-error").textContent = mapError(ex.message); $("rec-error").hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Pasahitza gorde";
  }
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error"); err.hidden = true;
  if (!configOk) {
    err.textContent = "Webgunea oraindik ez dago konfiguratuta (config.js). Jarri harremanetan administratzailearekin.";
    err.hidden = false; return;
  }
  const btn = $("login-btn"); btn.disabled = true; btn.textContent = "Sartzen...";
  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: $("login-email").value.trim(),
      password: $("login-password").value,
    });
    if (error) throw error;
    state.user = data.user;
    await enterApp();
  } catch (ex) {
    err.textContent = mapError(ex.message); err.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = "Saioa hasi";
  }
});

$("logout-btn").addEventListener("click", async () => {
  await db.auth.signOut();
  state.user = null; state.profile = null;
  showLogin();
});

/* ===========================================================
   DATUAK KARGATU
   =========================================================== */
async function loadProfiles() {
  const { data } = await db.from("profiles").select("*").order("full_name");
  state.profiles = {};
  (data || []).forEach(p => { state.profiles[p.id] = p; });
}

async function loadMonth() {
  // 6 asteko sareta erakusten dugu: lehen eta azken egun ikusgaiak kalkulatu
  const y = state.viewDate.getFullYear(), m = state.viewDate.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(y, m, 1 - offset);
  const end = new Date(y, m, 1 - offset + 41);
  const sIso = isoOf(start), eIso = isoOf(end);

  const [res, blk] = await Promise.all([
    db.from("reservations").select("*").gte("res_date", sIso).lte("res_date", eIso).order("start_time"),
    db.from("blocked_days").select("block_date").gte("block_date", sIso).lte("block_date", eIso),
  ]);
  state.monthRes = res.data || [];
  state.blocked = new Set((blk.data || []).map(b => b.block_date));
  renderCalendar();
}

/* ===========================================================
   EGUTEGIA
   =========================================================== */
function resByDate(iso) {
  return state.monthRes.filter(r => r.res_date === iso);
}

function renderCalendar() {
  const y = state.viewDate.getFullYear(), m = state.viewDate.getMonth();
  $("month-label").textContent = `${HILABETEAK[m]} ${y}`;

  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const todayIso = isoOf(new Date());
  const grid = $("cal-grid");
  grid.innerHTML = "";

  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - offset + i);
    const iso = isoOf(d);
    const cell = document.createElement("div");
    cell.className = "cell";
    if (d.getMonth() !== m) cell.classList.add("other-month");
    if (iso === todayIso) cell.classList.add("today");

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = d.getDate();
    cell.appendChild(num);

    if (state.blocked.has(iso)) {
      cell.classList.add("blocked");
      const tag = document.createElement("div");
      tag.className = "blocked-tag";
      tag.textContent = "Blokeatuta";
      cell.appendChild(tag);
    } else {
      const list = resByDate(iso);
      if (list.some(r => isElk(r.user_id))) {
        cell.classList.add("elk");
        const tag = document.createElement("div");
        tag.className = "elk-tag";
        tag.textContent = "Elkargunea";
        tag.title = "Elkargunearen erreserba";
        cell.appendChild(tag);
      }
      if (list.length) {
        const conc = maxConcurrent(list);
        const count = document.createElement("div");
        count.className = "count" + (conc >= AFOROA ? " full" : "");
        count.innerHTML = `<span class="c-long">${list.length} · ${conc}/${AFOROA}</span><span class="c-short">${list.length}</span>`;
        cell.appendChild(count);
      }
      cell.addEventListener("click", () => openDay(iso));
    }
    grid.appendChild(cell);
  }
}

$("prev-month").addEventListener("click", () => { state.viewDate.setMonth(state.viewDate.getMonth()-1); loadMonth(); });
$("next-month").addEventListener("click", () => { state.viewDate.setMonth(state.viewDate.getMonth()+1); loadMonth(); });
$("today-btn").addEventListener("click", () => { state.viewDate = new Date(); loadMonth(); });

/* ===========================================================
   EGUNAREN PANELA
   =========================================================== */
let activeDay = null;

function openDay(iso) {
  activeDay = iso;
  $("day-title").textContent = longDate(iso);
  const list = resByDate(iso).slice().sort((a,b) => hhmm(a.start_time).localeCompare(hhmm(b.start_time)));
  const conc = maxConcurrent(list);

  const occ = $("day-occupancy");
  occ.className = "occupancy" + (conc >= AFOROA ? " warn" : "");
  occ.innerHTML = list.length
    ? `Une bateko gehieneko betetzea: <b>${conc}/${AFOROA}</b> lagun · ${list.length} erreserba`
    : "";

  const box = $("day-list");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<p class="empty-note">Egun honetan ez dago erreserbarik oraindik.</p>`;
  } else {
    list.forEach(r => box.appendChild(resItem(r)));
  }
  $("day-new-btn").hidden = iso < todayIso();   // iraganeko egunetan ezin da erreserbatu
  $("day-modal").hidden = false;
}

function resItem(r) {
  const isMine = r.user_id === state.user.id;
  const elk = isElk(r.user_id);
  const canEdit = isMine || state.profile.role === "admin";
  const el = document.createElement("div");
  el.className = "res-item" + (elk ? " elk" : (isMine ? " mine" : ""));
  el.innerHTML = `
    <div class="ri-main">
      <div class="ri-time">${hhmm(r.start_time)} – ${hhmm(r.end_time)}
        <span class="ri-people">· ${r.num_people} lagun</span></div>
      <div class="ri-who">${elk ? '<span class="badge elk">Elkargunea</span> ' : ""}${escapeHtml(nameOf(r.user_id))}${isMine ? " (zu)" : ""}</div>
      ${r.notes ? `<div class="ri-notes">${escapeHtml(r.notes)}</div>` : ""}
    </div>`;
  if (canEdit) {
    const b = document.createElement("button");
    b.className = "ri-edit"; b.textContent = "Editatu";
    b.addEventListener("click", () => openResForm(r));
    el.appendChild(b);
  }
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

$("day-close").addEventListener("click", () => { $("day-modal").hidden = true; });
$("day-modal").addEventListener("click", (e) => { if (e.target.id === "day-modal") $("day-modal").hidden = true; });
$("day-new-btn").addEventListener("click", () => openResForm(null, activeDay));

/* ===========================================================
   ERRESERBA FORMULARIOA
   =========================================================== */
let editingOrigDate = null;

function openResForm(res, dateIso) {
  const editing = !!res;
  editingOrigDate = editing ? res.res_date : null;
  $("res-modal-title").textContent = editing ? "Erreserba editatu" : "Erreserba berria";
  $("res-id").value = editing ? res.id : "";
  $("res-date").value = editing ? res.res_date : (dateIso || isoOf(new Date()));
  $("res-start").value = editing ? hhmm(res.start_time) : "13:00";
  $("res-end").value = editing ? hhmm(res.end_time) : "16:00";
  $("res-people").value = editing ? res.num_people : 2;
  $("res-notes").value = editing ? (res.notes || "") : "";
  $("res-error").hidden = true;
  $("res-delete-btn").hidden = !editing;
  // Iraganeko datarik ezin da aukeratu (iraganeko erreserba bat editatzean izan ezik)
  if (editing && res.res_date < todayIso()) $("res-date").removeAttribute("min");
  else $("res-date").min = todayIso();
  $("res-modal").hidden = false;
}

$("res-close").addEventListener("click", () => { $("res-modal").hidden = true; });
$("res-cancel-btn").addEventListener("click", () => { $("res-modal").hidden = true; });

$("res-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("res-error"); err.hidden = true;
  const id = $("res-id").value;
  const payload = {
    res_date: $("res-date").value,
    start_time: $("res-start").value,
    end_time: $("res-end").value,
    num_people: parseInt($("res-people").value, 10),
  };
  const notes = $("res-notes").value.trim();
  payload.notes = notes;

  // Bezeroaren aldetiko egiaztapen azkarrak
  if (!payload.res_date || !payload.start_time || !payload.end_time) {
    return showResError("Bete eguna eta orduak.");
  }
  if (hhmm(payload.end_time) <= hhmm(payload.start_time)) {
    return showResError("Irteteko orduak iristeko ordua baino beranduagokoa izan behar du.");
  }
  if (!(payload.num_people >= 1 && payload.num_people <= AFOROA)) {
    return showResError(`Pertsona kopuruak 1 eta ${AFOROA} artekoa izan behar du.`);
  }
  if (payload.res_date < todayIso() && (!id || payload.res_date !== editingOrigDate)) {
    return showResError(mapError("DATA_IRAGANA"));
  }
  // Elkargunearen orduekin gainjartzea (zerbitzariak ere egiaztatzen du)
  const ownerId = id ? (state.monthRes.find(r => String(r.id) === String(id)) || {}).user_id : state.user.id;
  const newIsElk = isElk(ownerId);
  const clash = state.monthRes.find(r =>
    r.res_date === payload.res_date && String(r.id) !== String(id) &&
    hhmm(r.start_time) < hhmm(payload.end_time) && hhmm(r.end_time) > hhmm(payload.start_time) &&
    (newIsElk || isElk(r.user_id)));
  if (clash) return showResError(mapError(newIsElk ? "ELKARGUNE_GAINJARRIA" : "ELKARGUNE_ORDUAK"));

  const btn = $("res-save-btn"); btn.disabled = true; btn.textContent = "Gordetzen...";
  try {
    let error;
    if (id) {
      ({ error } = await db.from("reservations").update(payload).eq("id", id));
    } else {
      payload.user_id = state.user.id;
      ({ error } = await db.from("reservations").insert(payload));
    }
    if (error) throw error;
    $("res-modal").hidden = true;
    toast(id ? "Erreserba eguneratu da." : "Erreserba sortu da.");
    await loadMonth();
    if (activeDay) openDay(activeDay);
  } catch (ex) {
    showResError(mapError(ex.message));
  } finally {
    btn.disabled = false; btn.textContent = "Gorde";
  }
});

$("res-delete-btn").addEventListener("click", async () => {
  const id = $("res-id").value;
  if (!id) return;
  if (!confirm("Ziur erreserba hau ezabatu nahi duzula?")) return;
  const { error } = await db.from("reservations").delete().eq("id", id);
  if (error) { showResError(mapError(error.message)); return; }
  $("res-modal").hidden = true;
  toast("Erreserba ezabatu da.");
  await loadMonth();
  if (activeDay) openDay(activeDay);
});

function showResError(msg) {
  const err = $("res-error"); err.textContent = msg; err.hidden = false;
}

/* ===========================================================
   NABIGAZIOA (egutegia / kudeaketa)
   =========================================================== */
$("nav-calendar").addEventListener("click", () => switchView("calendar"));
$("nav-admin").addEventListener("click", () => switchView("admin"));
$("nav-account").addEventListener("click", () => switchView("account"));

function switchView(v) {
  $("calendar-section").hidden = v !== "calendar";
  $("admin-section").hidden = v !== "admin";
  $("account-section").hidden = v !== "account";
  $("nav-calendar").classList.toggle("is-active", v === "calendar");
  $("nav-admin").classList.toggle("is-active", v === "admin");
  $("nav-account").classList.toggle("is-active", v === "account");
  if (v === "admin") loadAdmin();
  if (v === "account") fillAccount();
}

/* ===========================================================
   NIRE KONTUA (izena eta pasahitza aldatu)
   =========================================================== */
function fillAccount() {
  $("acc-name").value = state.profile.full_name || "";
  $("acc-error").hidden = true;
  $("pw-error").hidden = true;
  $("pw-new").value = ""; $("pw-rep").value = "";
}

$("account-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("acc-error"); err.hidden = true;
  const full_name = $("acc-name").value.trim();
  if (!full_name) { err.textContent = "Idatzi zure izen-abizenak."; err.hidden = false; return; }
  const { error } = await db.from("profiles").update({ full_name }).eq("id", state.user.id);
  if (error) { err.textContent = mapError(error.message); err.hidden = false; return; }
  state.profile.full_name = full_name;
  if (state.profiles[state.user.id]) state.profiles[state.user.id].full_name = full_name;
  refreshGreeting();
  toast("Datuak gorde dira.");
});

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("pw-error"); err.hidden = true;
  const np = $("pw-new").value, rp = $("pw-rep").value;
  if (np.length < 6) { err.textContent = "Pasahitzak gutxienez 6 karaktere behar ditu."; err.hidden = false; return; }
  if (np !== rp) { err.textContent = "Pasahitzak ez datoz bat."; err.hidden = false; return; }
  const { error } = await db.auth.updateUser({ password: np });
  if (error) { err.textContent = mapError(error.message); err.hidden = false; return; }
  $("pw-new").value = ""; $("pw-rep").value = "";
  toast("Pasahitza aldatu da.");
});

/* ===========================================================
   ADMIN
   =========================================================== */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
    tab.classList.add("is-active");
    const which = tab.dataset.tab;
    $("pane-members").hidden = which !== "members";
    $("pane-blocked").hidden = which !== "blocked";
    $("pane-history").hidden = which !== "history";
  });
});

async function loadAdmin() {
  await Promise.all([renderMembers(), renderBlocked(), renderHistory()]);
}

async function callAdmin(body) {
  const { data, error } = await db.functions.invoke("admin", { body });
  if (error) {
    // Edge funtzioak itzulitako errore-mezua atera
    let msg = error.message;
    try { const ctx = await error.context?.json(); if (ctx?.error) msg = ctx.error; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ---- Bazkideak ---- */
async function renderMembers() {
  await loadProfiles();
  const tbody = $("members-table").querySelector("tbody");
  tbody.innerHTML = "";
  Object.values(state.profiles).sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||"")).forEach(p => {
    const tr = document.createElement("tr");
    const isMe = p.id === state.user.id;
    tr.innerHTML = `
      <td>${escapeHtml(p.full_name || "—")}</td>
      <td>${escapeHtml(p.email)}</td>
      <td><span class="badge ${p.role}">${p.role === "admin" ? "Admin" : "Bazkide"}</span>${p.elkargune ? ' <span class="badge elk">Elkargunea</span>' : ""}</td>`;
    const td = document.createElement("td");
    td.className = "rowbtns";
    if (!isMe && p.elkargune) {
      // Elkargunearen kontua babestuta: ezin da bazkide bihurtu ezta ezabatu ere
      td.appendChild(miniBtn("Pasahitza", () => resetPassword(p)));
    } else if (!isMe) {
      td.appendChild(miniBtn("Pasahitza", () => resetPassword(p)));
      td.appendChild(miniBtn(p.role === "admin" ? "→ Bazkide" : "→ Admin",
        () => setRole(p, p.role === "admin" ? "bazkide" : "admin")));
      td.appendChild(miniBtn("Ezabatu", () => deleteMember(p), true));
    } else {
      td.innerHTML = `<span style="color:var(--muted);font-size:.8rem">zu zara</span>`;
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  // Historiako iragazkia ere eguneratu
  const sel = $("hist-member");
  const cur = sel.value;
  sel.innerHTML = `<option value="">Denak</option>` +
    Object.values(state.profiles).sort((a,b)=>(a.full_name||"").localeCompare(b.full_name||""))
      .map(p => `<option value="${p.id}">${escapeHtml(p.full_name || p.email)}</option>`).join("");
  sel.value = cur;
}

function miniBtn(label, fn, danger) {
  const b = document.createElement("button");
  b.className = "mini-btn" + (danger ? " danger" : "");
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

$("new-member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("nm-error"); err.hidden = true;
  const body = {
    action: "create_user",
    full_name: $("nm-name").value.trim(),
    email: $("nm-email").value.trim(),
    password: $("nm-pass").value,
    role: $("nm-role").value,
  };
  try {
    await callAdmin(body);
    e.target.reset();
    toast("Bazkide berria sortu da.");
    await renderMembers();
  } catch (ex) {
    err.textContent = mapError(ex.message); err.hidden = false;
  }
});

async function resetPassword(p) {
  const np = prompt(`Pasahitz berria ${p.full_name || p.email}(r)entzat (gutxienez 6 karaktere):`);
  if (!np) return;
  try { await callAdmin({ action: "reset_password", id: p.id, password: np });
    toast("Pasahitza berrezarri da."); }
  catch (ex) { toast(mapError(ex.message), true); }
}

async function setRole(p, role) {
  try { await callAdmin({ action: "set_role", id: p.id, role });
    toast("Rola aldatu da."); await renderMembers(); }
  catch (ex) { toast(mapError(ex.message), true); }
}

async function deleteMember(p) {
  if (!confirm(`Ziur ${p.full_name || p.email} ezabatu nahi duzula? Bere erreserba guztiak ere ezabatuko dira.`)) return;
  try { await callAdmin({ action: "delete_user", id: p.id });
    toast("Bazkidea ezabatu da."); await renderMembers(); await loadMonth(); }
  catch (ex) { toast(mapError(ex.message), true); }
}

/* ---- Blokeatutako egunak ---- */
async function renderBlocked() {
  const { data } = await db.from("blocked_days").select("*").order("block_date");
  const tbody = $("blocked-table").querySelector("tbody");
  tbody.innerHTML = "";
  (data || []).forEach(b => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${longDate(b.block_date)}</td><td>${escapeHtml(b.reason || "—")}</td>`;
    const td = document.createElement("td");
    td.className = "rowbtns";
    td.appendChild(miniBtn("Kendu", () => unblock(b.block_date), true));
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
}

$("block-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("blk-error"); err.hidden = true;
  const block_date = $("blk-date").value;
  const reason = $("blk-reason").value.trim();
  if (!block_date) return;
  const { error } = await db.from("blocked_days").insert({ block_date, reason, created_by: state.user.id });
  if (error) { err.textContent = mapError(error.message); err.hidden = false; return; }
  e.target.reset();
  toast("Eguna blokeatu da.");
  await renderBlocked(); await loadMonth();
});

async function unblock(date) {
  if (!confirm("Egun honen blokeoa kendu?")) return;
  const { error } = await db.from("blocked_days").delete().eq("block_date", date);
  if (error) { toast(mapError(error.message), true); return; }
  toast("Blokeoa kendu da.");
  await renderBlocked(); await loadMonth();
}

/* ---- Erreserben historia ---- */
let allHistory = [];
async function renderHistory() {
  const { data } = await db.from("reservations").select("*").order("res_date", { ascending: false }).order("start_time");
  allHistory = data || [];
  applyHistoryFilters();
}

function applyHistoryFilters() {
  const member = $("hist-member").value;
  const from = $("hist-from").value;
  const to = $("hist-to").value;
  let rows = allHistory;
  if (member) rows = rows.filter(r => r.user_id === member);
  if (from) rows = rows.filter(r => r.res_date >= from);
  if (to) rows = rows.filter(r => r.res_date <= to);

  const tbody = $("history-table").querySelector("tbody");
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-note">Ez dago erreserbarik iragazki hauekin.</td></tr>`;
    return;
  }
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.res_date.split("-").reverse().join("/")}</td>
      <td>${hhmm(r.start_time)}–${hhmm(r.end_time)}</td>
      <td>${r.num_people}</td>
      <td>${isElk(r.user_id) ? '<span class="badge elk">Elkargunea</span> ' : ""}${escapeHtml(nameOf(r.user_id))}</td>
      <td>${escapeHtml(r.notes || "")}</td>`;
    tbody.appendChild(tr);
  });
}

["hist-member","hist-from","hist-to"].forEach(id => $(id).addEventListener("change", applyHistoryFilters));
$("hist-clear").addEventListener("click", () => {
  $("hist-member").value = ""; $("hist-from").value = ""; $("hist-to").value = "";
  applyHistoryFilters();
});

/* ===========================================================
   ABIARAZI
   =========================================================== */
(async function init() {
  if (!configOk) { showLogin(); return; }

  // Pasahitza berrezartzeko estekatik datorren egiaztatu
  let recovery = (window.location.hash || "").includes("type=recovery");

  db.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recovery = true;
      showLogin();
      showLoginForm("recovery");
    } else if (event === "SIGNED_OUT") {
      showLogin();
    }
  });

  if (recovery) {
    showLogin();
    showLoginForm("recovery");
    return;   // ez sartu aplikazioan; pasahitz berria eskatu
  }

  const { data } = await db.auth.getSession();
  if (data.session) {
    state.user = data.session.user;
    try { await enterApp(); } catch (_) { showLogin(); }
  } else {
    showLogin();
  }
})();
/* v5 — Elkargunearen orduak = aforo osoa · iraganeko egunetan ezin da erreserbatu */

/* ===========================================================
   PWA — Service Worker erregistroa (mugikorrean instalatzeko)
   =========================================================== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
