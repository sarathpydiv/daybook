/* ===== Pure logic: dates (Asia/Kolkata), money, recurrence, parsing, analytics ===== */
(function (root) {
  const TZ = 'Asia/Kolkata';
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const WD_LONG = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  const fmtParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  function istParts(d) {
    const p = {};
    fmtParts.formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
    if (p.hour === '24') p.hour = '00';
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  }
  const today = () => istParts().date;
  const nowTime = () => istParts().time;
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  const iso = dt => dt.toISOString().slice(0, 10);
  function addDays(s, n) { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  function addMonths(s, n, anchorDay) {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(anchorDay || d, last));
    return iso(t);
  }
  const dow = s => parseD(s).getUTCDay();
  const diffDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);
  const weekStart = s => addDays(s, -((dow(s) + 6) % 7));
  const monthStart = s => s.slice(0, 8) + '01';
  const monthEnd = s => addDays(addMonths(monthStart(s), 1), -1);
  function fmtDate(s) { if (!isDate(s)) return ''; const [y, m, d] = s.split('-'); return `${d} ${MONTHS[+m - 1]} ${y}`; }
  function fmtShort(s) { if (!isDate(s)) return ''; const [, m, d] = s.split('-'); return `${d} ${MONTHS[+m - 1]}`; }
  function fmtTime(hm) {
    if (!isTime(hm)) return '';
    let [h, m] = hm.split(':').map(Number);
    const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  }
  function relDay(s, t) {
    t = t || today(); if (!isDate(s)) return '';
    const n = diffDays(t, s);
    if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
    if (n > 1 && n < 7) return WD[dow(s)] + ', ' + fmtShort(s);
    return fmtDate(s);
  }
  function fmtStamp(isoStr) { if (!isoStr) return ''; const p = istParts(new Date(isoStr)); return fmtDate(p.date) + ', ' + fmtTime(p.time); }
  const istDateOf = isoStr => isoStr ? istParts(new Date(isoStr)).date : null;
  function rangeDates(from, to) { const out = []; let d = from; let guard = 0; while (d <= to && guard++ < 4000) { out.push(d); d = addDays(d, 1); } return out; }

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const money = n => inr.format(Math.round((Number(n) || 0) * 100) / 100);
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

  /* ---------- recurrence ---------- */
  function stepRecur(date, recur) {
    const iv = Math.max(1, parseInt(recur.interval, 10) || 1);
    switch (recur.freq) {
      case 'daily': return addDays(date, iv);
      case 'weekdays': { let d = addDays(date, 1); while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1); return d; }
      case 'weekly': return addDays(date, 7 * iv);
      case 'monthly': return addMonths(date, iv, recur.anchorDay);
      case 'quarterly': return addMonths(date, 3 * iv, recur.anchorDay);
      case 'yearly': return addMonths(date, 12 * iv, recur.anchorDay);
      default: return null;
    }
  }
  // next occurrence strictly after `due`, then advanced to on/after today
  function nextOccurrence(due, recur, t) {
    t = t || today();
    let n = stepRecur(due, recur); let guard = 0;
    while (n && n < t && guard++ < 2000) n = stepRecur(n, recur);
    return n;
  }
  function safeSeg(s) { return String(s).replace(/[^A-Za-z0-9_\-.~:@+]/g, '-'); }
  // Complete a task. Returns {done, next}. `next` has a deterministic id so it is never duplicated.
  function completeTask(task, nowIso, t) {
    t = t || today();
    const done = Object.assign({}, task, { status: 'done', completedAt: nowIso });
    if (!task.recur || !task.recur.freq) return { done, next: null };
    const seriesId = task.seriesId || task.id;
    const base = task.due || t;
    const nd = nextOccurrence(base, task.recur, t);
    if (!nd) return { done, next: null };
    done.seriesId = seriesId;
    const shift = diffDays(base, nd);
    let reminder = null;
    if (task.reminder && task.reminder.at) {
      const [rd, rt] = task.reminder.at.split('T');
      const keep = task.reminder.repeat && task.reminder.repeat !== 'none';
      reminder = Object.assign({}, task.reminder, { at: addDays(rd, shift) + 'T' + (rt || '09:00'), status: keep ? task.reminder.status : 'not_configured', ref: keep ? task.reminder.ref : '' });
    }
    const next = Object.assign({}, task, {
      id: safeSeg(seriesId + '~' + nd), seriesId, due: nd, status: 'todo', completedAt: null,
      subtasks: (task.subtasks || []).map(s => Object.assign({}, s, { done: false })),
      reminder, focus: null, rev: 0, createdAt: nowIso, updatedAt: nowIso, archived: false
    });
    done.nextId = next.id;
    return { done, next };
  }
  function occurrences(ev, from, to) {
    if (!isDate(ev.date)) return [];
    if (!ev.recur || !ev.recur.freq) return (ev.date >= from && ev.date <= to) ? [ev.date] : [];
    const out = []; let d = ev.date; let guard = 0;
    const until = ev.recur.until && isDate(ev.recur.until) ? ev.recur.until : null;
    while (d && d <= to && guard++ < 3000) {
      if (until && d > until) break;
      if (d >= from) out.push(d);
      d = stepRecur(d, ev.recur);
    }
    return out;
  }

  /* ---------- bills ---------- */
  function billState(b, t) {
    t = t || today();
    if (!b.nextDue) return { key: 'done', label: 'Settled' };
    const n = diffDays(t, b.nextDue);
    if (n < 0) return { key: 'overdue', label: `Overdue ${-n}d` };
    if (n === 0) return { key: 'due', label: 'Due today' };
    if (n <= 7) return { key: 'due', label: `Due in ${n}d` };
    return { key: 'upcoming', label: 'Upcoming' };
  }
  function billProjection(b, from, to) {
    if (!b.nextDue || b.archived) return [];
    if (b.freq === 'once') return (b.nextDue <= to) ? [b.nextDue] : [];
    const out = []; let d = b.nextDue; let g = 0;
    while (d <= to && g++ < 500) { out.push(d); d = stepRecur(d, { freq: b.freq, anchorDay: b.anchorDay }); }
    return out.filter(x => x >= from || x < from && x === b.nextDue); // keep overdue nextDue
  }

  /* ---------- analytics ---------- */
  const OPEN = s => s === 'todo' || s === 'doing' || s === 'waiting';
  function taskStats(tasks, from, to, t) {
    t = t || today();
    const live = tasks.filter(x => x.status !== 'cancelled');
    const completed = live.filter(x => x.status === 'done' && x.completedAt && (() => { const d = istDateOf(x.completedAt); return d >= from && d <= to; })());
    const withDue = completed.filter(x => isDate(x.due));
    const onTime = withDue.filter(x => {
      const c = istParts(new Date(x.completedAt));
      if (c.date < x.due) return true; if (c.date > x.due) return false;
      return !isTime(x.dueTime) || c.time <= x.dueTime;
    });
    const overdueNow = live.filter(x => OPEN(x.status) && !x.archived && isDate(x.due) && x.due < t);
    const dueInRange = live.filter(x => isDate(x.due) && x.due >= from && x.due <= to && !x.archived);
    return {
      completed: completed.length, withDue: withDue.length, onTime: onTime.length,
      onTimeRate: withDue.length >= 3 ? onTime.length / withDue.length : null,
      overdueNow: overdueNow.length, dueInRange: dueInRange.length, completedList: completed
    };
  }
  function groupCount(list, keyFn) {
    const m = new Map(); list.forEach(x => { const k = keyFn(x) || 'None'; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, v]) => ({ key: k, value: v })).sort((a, b) => b.value - a.value);
  }
  function weeklyCompletions(tasks, weeks, endDate) {
    const end = weekStart(endDate || today()); const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = addDays(end, -7 * i), we = addDays(ws, 6);
      const c = tasks.filter(x => x.status === 'done' && x.completedAt && (() => { const d = istDateOf(x.completedAt); return d >= ws && d <= we; })()).length;
      out.push({ key: ws, value: c });
    }
    return out;
  }
  const habitScheduled = (h, d) => !h.days || h.days.length === 0 || h.days.length === 7 || h.days.includes(dow(d));
  function habitStats(h, from, to, t) {
    t = t || today();
    const start = h.startDate || (h.createdAt ? istDateOf(h.createdAt) : from);
    const a = from > start ? from : start; const b = to < t ? to : t;
    let scheduled = 0, done = 0, skip = 0, notRec = 0, pending = 0;
    if (a <= b) rangeDates(a, b).forEach(d => {
      if (!habitScheduled(h, d)) return;
      const v = (h.log || {})[d];
      if (v === 'done') { done++; scheduled++; }
      else if (v === 'skip') { skip++; scheduled++; }
      else if (d === t) { pending++; }
      else { notRec++; scheduled++; }
    });
    return {
      scheduled, done, skip, notRec, pending,
      ofScheduled: scheduled >= 3 ? done / scheduled : null,
      ofRecorded: (done + skip) >= 3 ? done / (done + skip) : null,
      streak: habitStreak(h, t)
    };
  }
  function habitStreak(h, t) {
    t = t || today(); let d = t; let n = 0; let g = 0;
    const log = h.log || {};
    const start = h.startDate || (h.createdAt ? istDateOf(h.createdAt) : t);
    if (!log[d]) d = addDays(d, -1); // today not yet recorded does not break the streak
    while (d >= start && g++ < 3660) {
      if (habitScheduled(h, d)) {
        if (log[d] === 'done') n++;
        else if (log[d] === 'skip') { /* skip pauses */ }
        else break;
      }
      d = addDays(d, -1);
    }
    return n;
  }
  function spendStats(expenses, from, to) {
    const rows = expenses.filter(e => !e.archived && isDate(e.date) && e.date >= from && e.date <= to && e.kind !== 'transfer');
    const sign = e => e.kind === 'refund' ? -1 : 1;
    const total = round2(rows.reduce((s, e) => s + sign(e) * (Number(e.amount) || 0), 0));
    const m = new Map(); rows.forEach(e => { const k = e.category || 'Other'; m.set(k, round2((m.get(k) || 0) + sign(e) * (Number(e.amount) || 0))); });
    const transfers = expenses.filter(e => !e.archived && e.kind === 'transfer' && isDate(e.date) && e.date >= from && e.date <= to).length;
    return { total, count: rows.length, byCat: [...m.entries()].map(([k, v]) => ({ key: k, value: v })).sort((a, b) => b.value - a.value), transfers };
  }
  function goalProgress(g) {
    if (!g.metric || g.metric.target === '' || g.metric.target == null) {
      const ms = g.milestones || []; if (!ms.length) return null;
      return { pct: ms.filter(m => m.done).length / ms.length, label: `${ms.filter(m => m.done).length} of ${ms.length} milestones` };
    }
    const s = Number(g.metric.start) || 0, tg = Number(g.metric.target), c = Number(g.metric.current ?? s);
    if (!isFinite(tg) || tg === s) return null;
    const pct = Math.max(0, Math.min(1, (c - s) / (tg - s)));
    return { pct, label: `${c} of ${tg} ${g.metric.unit || ''}`.trim() };
  }
  function findDuplicates(exp, list) {
    return list.filter(e => e.id !== exp.id && !e.archived && e.date === exp.date && round2(e.amount) === round2(exp.amount) && (e.kind || 'expense') === (exp.kind || 'expense'));
  }

  /* ---------- natural-language capture ---------- */
  const MONTH_RX = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
  function monthIdx(s) { return ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(s.slice(0, 3)); }
  function parseDateWords(text, t) {
    t = t || today(); let s = ' ' + text + ' '; let date = null, time = null;
    const take = (rx, fn) => { const m = s.match(rx); if (m && !date) { const r = fn(m); if (r) { date = r; s = s.replace(m[0], ' '); } } };
    take(/\s(today|tonight)\s/i, () => t);
    take(/\s(tomorrow|tmrw|tmr)\s/i, () => addDays(t, 1));
    take(/\s(yesterday)\s/i, () => addDays(t, -1));
    take(/\sin\s(\d{1,3})\s(day|days|week|weeks)\s/i, m => addDays(t, (+m[1]) * (/week/i.test(m[2]) ? 7 : 1)));
    take(/\s(next\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday)?\s/i, m => {
      const k = WD_LONG.findIndex(w => w.startsWith(m[2].toLowerCase().slice(0, 3)));
      let n = (k - dow(t) + 7) % 7; if (n === 0) n = 7; if (m[1]) n = n < 7 ? n + 7 : n; return addDays(t, n);
    });
    take(new RegExp('\\s(\\d{1,2})(st|nd|rd|th)?\\s' + MONTH_RX + '(\\s(\\d{4}))?\\s', 'i'), m => mk(+m[1], monthIdx(m[3].toLowerCase()), m[5]));
    take(new RegExp('\\s' + MONTH_RX + '\\s(\\d{1,2})(st|nd|rd|th)?(\\s(\\d{4}))?\\s', 'i'), m => mk(+m[2], monthIdx(m[1].toLowerCase()), m[5]));
    take(/\s(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?\s/, m => mk(+m[1], +m[2] - 1, m[4] && (m[4].length === 2 ? '20' + m[4] : m[4])));
    function mk(d, mi, y) {
      if (mi < 0 || mi > 11 || d < 1 || d > 31) return null;
      let yr = y ? +y : +t.slice(0, 4);
      let cand = `${yr}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso(parseD(cand)) !== cand) return null;
      if (!y && cand < t) { yr++; cand = `${yr}-${cand.slice(5)}`; }
      return cand;
    }
    const rxs = [/\s(?:at\s)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)\s/i, /\sat\s(\d{1,2})(?::(\d{2}))?()\s/i, /\s(\d{1,2}):(\d{2})()\s/];
    for (const rx of rxs) {
      const tm = s.match(rx); if (!tm) continue;
      let h = +tm[1], mi = tm[2] ? +tm[2] : 0; const ap = (tm[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      if (h < 24 && mi < 60) { time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; s = s.replace(tm[0], ' '); break; }
    }
    return { rest: s.replace(/\s+/g, ' ').trim(), date, time };
  }
  function parseTask(text, t) {
    let s = ' ' + text + ' '; let scope = null, priority = null; const tags = [];
    s = s.replace(/\s#(work|office)\b/ig, () => { scope = 'work'; return ' '; });
    s = s.replace(/\s#(personal|home)\b/ig, () => { scope = 'personal'; return ' '; });
    s = s.replace(/\s!(high|h|1|urgent)\b/ig, () => { priority = 'high'; return ' '; });
    s = s.replace(/\s!(med|medium|m|2)\b/ig, () => { priority = 'med'; return ' '; });
    s = s.replace(/\s!(low|l|3)\b/ig, () => { priority = 'low'; return ' '; });
    s = s.replace(/\s#([\w-]+)/g, (_, g) => { tags.push(g.toLowerCase()); return ' '; });
    const d = parseDateWords(s, t);
    return { title: d.rest.replace(/\s(on|by|at|due)$/i, '').trim(), due: d.date, dueTime: d.time, scope, priority, tags };
  }
  const EXP_CATS = [
    ['Food & Dining', /lunch|dinner|breakfast|coffee|tea|swiggy|zomato|restaurant|cafe|snack|food/i],
    ['Groceries', /grocer|bigbasket|blinkit|zepto|vegetable|fruit|milk|supermarket|dmart/i],
    ['Transport', /uber|ola|rapido|auto|cab|metro|bus|fuel|petrol|diesel|parking|toll|train|flight/i],
    ['Bills & Utilities', /electric|bescom|water|gas|internet|broadband|wifi|recharge|mobile|phone bill|dth/i],
    ['Shopping', /amazon|flipkart|myntra|clothes|shoes|shopping/i],
    ['Health', /doctor|pharma|medicine|hospital|clinic|lab|gym/i],
    ['Entertainment', /movie|netflix|spotify|prime|hotstar|concert|game/i],
    ['Home', /rent|maid|cook|repair|plumber|electrician|furniture/i],
    ['Travel', /hotel|trip|travel|airbnb/i],
    ['Work', /client|office|software|subscription|cowork|stationery/i]
  ];
  function guessExpenseCat(text) { const f = EXP_CATS.find(([, rx]) => rx.test(text)); return f ? f[0] : 'Other'; }
  function parseExpense(text, t) {
    let s = ' ' + text + ' '; let scope = null;
    s = s.replace(/\s#(work|office)\b/ig, () => { scope = 'work'; return ' '; });
    s = s.replace(/\s#(personal|home)\b/ig, () => { scope = 'personal'; return ' '; });
    const m = s.match(/(₹|rs\.?|inr)?\s?(\d{1,3}(,\d{2,3})+|\d+)(\.\d{1,2})?\s?(k\b)?/i);
    let amount = null;
    if (m) { amount = parseFloat((m[2] + (m[4] || '')).replace(/,/g, '')); if (m[5]) amount *= 1000; s = s.replace(m[0], ' '); }
    const d = parseDateWords(s, t);
    const note = d.rest.replace(/^(for|on)\s/i, '').trim();
    return { amount, date: d.date || t || today(), note, category: guessExpenseCat(note), scope };
  }
  const UNITS = ['kg','g','gm','gms','l','ltr','litre','ml','pc','pcs','pack','packs','dozen','doz','bottle','bottles','box','bunch','loaf','can','tin','packet','packets'];
  const GROC_CATS = [
    ['Produce', /onion|tomato|potato|carrot|spinach|palak|coriander|chilli|ginger|garlic|lemon|banana|apple|mango|orange|grape|veg|fruit|cucumber|beans|cabbage|cauliflower|capsicum|methi|mint|curry leaves/i],
    ['Dairy', /milk|curd|yogurt|paneer|cheese|butter|ghee|cream|egg/i],
    ['Staples', /rice|atta|flour|dal|lentil|sugar|salt|oil|maida|rava|sooji|poha|besan|spice|masala|turmeric|jeera|tea|coffee|bread|oats|pasta|noodle/i],
    ['Snacks', /biscuit|chips|namkeen|chocolate|cookie|juice|soda|nuts|almond|cashew/i],
    ['Household', /soap|detergent|shampoo|toothpaste|tissue|dishwash|cleaner|phenyl|garbage bag|foil|brush|bulb|battery/i]
  ];
  function guessGroceryCat(name) { const f = GROC_CATS.find(([, rx]) => rx.test(name)); return f ? f[0] : 'Other'; }
  function parseGrocery(text) {
    let s = text.trim(); let qty = null, unit = '';
    const uRx = UNITS.join('|');
    let m = s.match(new RegExp('^(\\d+(\\.\\d+)?)\\s?(' + uRx + ')?\\b\\s*(of\\s)?(.+)$', 'i'));
    if (m) { qty = parseFloat(m[1]); unit = (m[3] || '').toLowerCase(); s = m[5]; }
    else {
      m = s.match(new RegExp('^(.+?)\\s+(x\\s?)?(\\d+(\\.\\d+)?)\\s?(' + uRx + ')?$', 'i'));
      if (m) { s = m[1]; qty = parseFloat(m[3]); unit = (m[5] || '').toLowerCase(); }
    }
    const name = s.trim().replace(/^\w/, c => c.toUpperCase());
    return { name, qty, unit, category: guessGroceryCat(name) };
  }

  /* ---------- CSV ---------- */
  function toCSV(rows, cols) {
    const q = v => { if (v == null) return ''; const s = Array.isArray(v) ? v.join('; ') : String(v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"' : s; };
    return [cols.map(c => q(c.label)).join(','), ...rows.map(r => cols.map(c => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n');
  }

  const L = { TZ, MONTHS, WD, istParts, today, nowTime, isDate, isTime, parseD, addDays, addMonths, dow, diffDays, weekStart, monthStart, monthEnd,
    fmtDate, fmtShort, fmtTime, relDay, fmtStamp, istDateOf, rangeDates, money, round2, stepRecur, nextOccurrence, completeTask, occurrences, safeSeg,
    billState, billProjection, OPEN, taskStats, groupCount, weeklyCompletions, habitScheduled, habitStats, habitStreak, spendStats, goalProgress,
    findDuplicates, parseDateWords, parseTask, parseExpense, parseGrocery, guessExpenseCat, guessGroceryCat, toCSV, EXP_CATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = L; else root.L = L;
})(typeof window !== 'undefined' ? window : globalThis);
/* ===== Calendar feed (iCalendar) builder. Pure; shared by the app and the Supabase Edge Function. ===== */
(function (root) {
  const IST_MIN = 330; // Asia/Kolkata is UTC+05:30 all year (no daylight saving)
  const pad = n => String(n).padStart(2, '0');
  function utcStamp(date, time) { // date 'YYYY-MM-DD', time 'HH:MM' in IST -> 'YYYYMMDDTHHMMSSZ'
    const [y, m, d] = date.split('-').map(Number); const [h, mi] = (time || '00:00').split(':').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d, h, mi) - IST_MIN * 60000);
    return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00Z`;
  }
  const dateOnly = d => d.replace(/-/g, '');
  function addDaysStr(s, n) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
  function addMin(date, time, n) { const [h, m] = time.split(':').map(Number); let tot = h * 60 + m + n; let dd = date; while (tot >= 1440) { tot -= 1440; dd = addDaysStr(dd, 1); } return [dd, `${pad(Math.floor(tot / 60))}:${pad(tot % 60)}`]; }
  const esc = s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) { // RFC 5545: lines over 75 octets are folded
    const out = []; let cur = ''; let bytes = 0;
    for (const ch of line) { const b = new TextEncoder().encode(ch).length; if (bytes + b > 74) { out.push(cur); cur = ' ' + ch; bytes = 1 + b; } else { cur += ch; bytes += b; } }
    out.push(cur); return out.join('\r\n');
  }
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
  const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const money = n => '₹' + (Math.round((+n || 0) * 100) / 100).toLocaleString('en-IN');
  function rrule(recur) {
    if (!recur || !recur.freq) return null;
    const iv = Math.max(1, parseInt(recur.interval, 10) || 1);
    let r = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY', quarterly: 'FREQ=MONTHLY', yearly: 'FREQ=YEARLY' }[recur.freq];
    if (!r) return null;
    const ivv = recur.freq === 'quarterly' ? 3 * iv : iv; if (ivv > 1) r += ';INTERVAL=' + ivv;
    if (isDate(recur.until)) r += ';UNTIL=' + utcStamp(recur.until, '23:59');
    return 'RRULE:' + r;
  }
  // minutes from event start (IST date/time) to alarm moment (IST datetime string 'YYYY-MM-DDTHH:MM'); negative = before
  function relMinutes(startDate, startTime, at) {
    const a = Date.parse(utcStamp(at.slice(0, 10), at.slice(11, 16)).replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
    const s = Date.parse(utcStamp(startDate, startTime || '00:00').replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'));
    return Math.round((a - s) / 60000);
  }
  function trig(mins) { const neg = mins < 0; let m = Math.abs(mins); const d = Math.floor(m / 1440); m -= d * 1440; const h = Math.floor(m / 60); m -= h * 60;
    return `TRIGGER:${neg ? '-' : ''}P${d ? d + 'D' : ''}${h || m || !d ? 'T' : ''}${h ? h + 'H' : ''}${m || (!h && !d) ? m + 'M' : ''}`; }
  const alarm = (trigger, text) => ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(text), trigger, 'END:VALARM'];
  const live = r => r && !r.archived;
  const OPEN = s => !s || s === 'todo' || s === 'doing' || s === 'waiting';

  function buildCalendar(rows, opts) {
    opts = opts || {}; const now = opts.now || new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const by = c => rows.filter(r => r.coll === c && live(r.data)).map(r => Object.assign({ id: r.id }, r.data));
    const ev = [];
    const push = (uid, lines) => ev.push(['BEGIN:VEVENT', 'UID:' + uid + '@daybook', 'DTSTAMP:' + stamp, ...lines.filter(Boolean).flat(), 'END:VEVENT']);
    const scopeTag = r => r.scope === 'work' ? 'Work' : 'Personal';
    const allDay = d => ['DTSTART;VALUE=DATE:' + dateOnly(d), 'DTEND;VALUE=DATE:' + dateOnly(addDaysStr(d, 1)), 'TRANSP:TRANSPARENT'];
    const loc = (d, t) => dateOnly(d) + 'T' + t.replace(':', '') + '00';
    const timed = (d, t, mins) => { const [ed, et] = addMin(d, t, mins); return ['DTSTART;TZID=Asia/Kolkata:' + loc(d, t), 'DTEND;TZID=Asia/Kolkata:' + loc(ed, et)]; };
    const nineAm = 9 * 60; // alarms for all-day items fire at 09:00 on the device's clock

    by('tasks').forEach(t => {
      if (!OPEN(t.status)) return;
      const rem = t.reminder && t.reminder.at && isDate(t.reminder.at.slice(0, 10)) ? t.reminder : null;
      const summary = (t.priority === 'high' ? '❗ ' : '') + 'Due: ' + t.title;
      const desc = [scopeTag(t), t.notes].filter(Boolean).join('\n');
      if (isDate(t.due)) {
        const lines = isTime(t.dueTime) ? timed(t.due, t.dueTime, 15) : allDay(t.due);
        let al = null;
        if (rem) al = alarm(isTime(t.dueTime) ? trig(relMinutes(t.due, t.dueTime, rem.at)) : 'TRIGGER;VALUE=DATE-TIME:' + utcStamp(rem.at.slice(0, 10), rem.at.slice(11, 16)), t.title);
        push('task-' + t.id, [lines, 'SUMMARY:' + esc(summary), 'DESCRIPTION:' + esc(desc), 'CATEGORIES:' + scopeTag(t) + ',Deadline', al]);
      } else if (rem) {
        push('task-' + t.id, [timed(rem.at.slice(0, 10), rem.at.slice(11, 16), 5), 'SUMMARY:' + esc('Reminder: ' + t.title), 'DESCRIPTION:' + esc(desc), 'CATEGORIES:' + scopeTag(t) + ',Reminder', alarm('TRIGGER:PT0M', t.title)]);
      }
    });
    by('events').forEach(e => {
      if (!isDate(e.date)) return;
      const rr = rrule(e.recur);
      const lines = (e.allDay || !isTime(e.start)) ? allDay(e.date) : (() => { const dur = isTime(e.end) && e.end > e.start ? (+e.end.slice(0, 2) * 60 + +e.end.slice(3)) - (+e.start.slice(0, 2) * 60 + +e.start.slice(3)) : 30; return timed(e.date, e.start, dur); })();
      let al = null;
      if (e.reminder && e.reminder.at) al = alarm(trig(relMinutes(e.date, (e.allDay || !isTime(e.start)) ? '00:00' : e.start, e.reminder.at)), e.title);
      const kind = { appointment: 'Appointment', block: 'Work block', reminder: 'Reminder', date: 'Important date' }[e.kind] || 'Appointment';
      push('event-' + e.id, [lines, rr, 'SUMMARY:' + esc(e.title), e.location ? 'LOCATION:' + esc(e.location) : null, 'DESCRIPTION:' + esc([kind, scopeTag(e), e.notes].filter(Boolean).join('\n')), 'CATEGORIES:' + scopeTag(e) + ',' + kind, al]);
    });
    by('bills').forEach(b => {
      if (!isDate(b.nextDue)) return;
      const al = b.reminder && b.reminder.at ? alarm(trig(relMinutes(b.nextDue, '00:00', b.reminder.at)), b.name) : alarm(trig(nineAm), b.name + ' due today');
      push('bill-' + b.id + '-' + b.nextDue, [allDay(b.nextDue), 'SUMMARY:' + esc(`Bill: ${b.name} · ${money(b.amount)}`), 'DESCRIPTION:' + esc(scopeTag(b) + (b.autopay ? '\nAutopay' : '')), 'CATEGORIES:' + scopeTag(b) + ',Bill', al]);
    });
    by('docs').forEach(d => {
      [['expiry', 'Expires'], ['renewal', 'Renew']].forEach(([k, l]) => {
        if (!isDate(d[k])) return;
        push(`doc-${d.id}-${k}`, [allDay(d[k]), 'SUMMARY:' + esc(`${l}: ${d.title}`), 'CATEGORIES:' + scopeTag(d) + ',Document', alarm(trig(-7 * 1440 + nineAm), `${l} in 7 days: ${d.title}`)]);
      });
    });
    by('projects').forEach(p => {
      if (p.status === 'done') return;
      if (isDate(p.deadline)) push('project-' + p.id, [allDay(p.deadline), 'SUMMARY:' + esc('Project deadline: ' + p.name), 'CATEGORIES:' + scopeTag(p) + ',Project', alarm(trig(-1440 + nineAm), 'Due tomorrow: ' + p.name)]);
      (p.milestones || []).forEach(m => { if (!m.done && isDate(m.due)) push(`ms-${p.id}-${m.id}`, [allDay(m.due), 'SUMMARY:' + esc(`Milestone: ${m.title} (${p.name})`), 'CATEGORIES:' + scopeTag(p) + ',Milestone']); });
    });
    by('habits').forEach(h => {
      if (!(h.reminder && h.reminder.at)) return;
      const start = h.reminder.at.slice(0, 10), time = h.reminder.at.slice(11, 16);
      const days = (h.days && h.days.length && h.days.length < 7) ? ';BYDAY=' + h.days.map(d => BYDAY[d]).join(',') : '';
      push('habit-' + h.id, [timed(start, time, 5), 'RRULE:FREQ=' + (days ? 'WEEKLY' : 'DAILY') + days, 'SUMMARY:' + esc('Habit: ' + h.title), 'CATEGORIES:' + scopeTag(h) + ',Habit', alarm('TRIGGER:PT0M', h.title)]);
    });
    const head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daybook//Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + esc(opts.name || 'Daybook'), 'X-WR-TIMEZONE:Asia/Kolkata', 'REFRESH-INTERVAL;VALUE=DURATION:PT30M', 'X-PUBLISHED-TTL:PT30M',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Kolkata', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD', 'END:VTIMEZONE'];
    return [...head, ...ev.flat(), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
  }
  const ICS = { buildCalendar, utcStamp, trig, relMinutes, rrule, fold };
  if (typeof module !== 'undefined' && module.exports) module.exports = ICS; else root.ICS = ICS;
})(typeof window !== 'undefined' ? window : globalThis);
/* ===== Cloud: Supabase sync with an offline cache. Exposes the same small db API the app uses. ===== */
const Cloud = (() => {
  let sb = null, uid = null, email = '', channel = null;
  let cache = {};               // 'coll/id' -> data
  const subs = [];              // {kind, c|path, next}
  let saveT = null;
  const cfgLocal = () => { try { return JSON.parse(localStorage.getItem('daybook.cfg') || '{}'); } catch (e) { return {}; } };
  function cfg() {
    const g = window.DAYBOOK_CONFIG || {}; const l = cfgLocal();
    const url = (l.url || g.supabaseUrl || '').trim().replace(/\/+$/, ''); const key = (l.key || g.supabaseKey || '').trim();
    return { url, key, fromFile: !!(g.supabaseUrl && g.supabaseKey && !l.url) };
  }
  const configured = () => { const c = cfg(); return /^https:\/\/.+/.test(c.url) && c.key.length > 20; };
  function setCfg(url, key) { localStorage.setItem('daybook.cfg', JSON.stringify({ url: url.trim(), key: key.trim() })); }
  function clearCfg() { localStorage.removeItem('daybook.cfg'); }
  function normErr(e) {
    if (!e) return { code: 'unavailable', message: 'Unknown error' };
    const msg = String(e.message || e.error_description || e);
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return { code: 'offline', message: msg };
    if (/JWT|expired|not authenticated|401/i.test(msg) || e.status === 401) return { code: 'auth', message: msg };
    if (/row-level security|permission|403/i.test(msg)) return { code: 'invalid_argument', message: msg };
    if (/too large|payload/i.test(msg)) return { code: 'invalid_argument', message: msg };
    return { code: 'unavailable', message: msg };
  }
  const snapColl = c => {
    const docs = Object.keys(cache).filter(k => k.startsWith(c + '/')).map(k => ({ id: k.slice(c.length + 1), exists: true, data: () => cache[k] }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } };
  };
  const snapDoc = p => ({ id: p.split('/')[1], exists: !!cache[p], data: () => cache[p], metadata: {} });
  function emit(c) { subs.forEach(s => { if (s.kind === 'coll' && (c == null || s.c === c)) s.next(snapColl(s.c)); if (s.kind === 'doc' && (c == null || s.path.startsWith(c + '/'))) s.next(snapDoc(s.path)); }); }
  const cacheKey = () => 'daybook.cache.' + uid;
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(cacheKey(), JSON.stringify(cache)); } catch (e) { /* storage full: cache is a convenience */ } }, 300); }
  function loadCache() { try { cache = JSON.parse(localStorage.getItem(cacheKey()) || '{}') || {}; } catch (e) { cache = {}; } emit(); }
  async function fullSync() {
    const all = {}; let from = 0; const page = 1000;
    for (;;) {
      const { data, error } = await sb.from('records').select('coll,id,data').eq('user_id', uid).range(from, from + page - 1);
      if (error) throw normErr(error);
      data.forEach(r => { all[r.coll + '/' + r.id] = r.data; });
      if (data.length < page) break; from += page;
    }
    cache = all; persist(); emit();
  }
  function subscribe(onState) {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('records-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'records', filter: 'user_id=eq.' + uid }, p => {
        if (p.eventType === 'DELETE') { const o = p.old || {}; if (o.user_id && o.user_id !== uid) return; if (o.coll && o.id) { delete cache[o.coll + '/' + o.id]; persist(); emit(o.coll); } return; }
        const n = p.new; if (!n || n.user_id !== uid) return;
        cache[n.coll + '/' + n.id] = n.data; persist(); emit(n.coll);
      })
      .subscribe(st => onState && onState(st));
  }
  const docRef = (c, id) => ({
    id, path: c + '/' + id,
    async set(data) {
      const k = c + '/' + id; cache[k] = JSON.parse(JSON.stringify(data)); persist(); emit(c);
      const { error } = await sb.from('records').upsert({ user_id: uid, coll: c, id, data: cache[k], updated_at: new Date().toISOString() });
      if (error) throw normErr(error);
    },
    async delete() {
      const k = c + '/' + id; const prev = cache[k]; delete cache[k]; persist(); emit(c);
      const { error } = await sb.from('records').delete().match({ user_id: uid, coll: c, id });
      if (error) { if (prev) { cache[k] = prev; persist(); emit(c); } throw normErr(error); }
    },
    onSnapshot(next) { const s = { kind: 'doc', path: c + '/' + id, next }; subs.push(s); setTimeout(() => next(snapDoc(s.path)), 0); return () => subs.splice(subs.indexOf(s), 1); }
  });
  const db = {
    collection: c => ({ path: c, doc: id => docRef(c, id), onSnapshot(next) { const s = { kind: 'coll', c, next }; subs.push(s); setTimeout(() => next(snapColl(c)), 0); return () => subs.splice(subs.indexOf(s), 1); } }),
    doc: p => { const [c, id] = p.split('/'); return docRef(c, id); }
  };
  async function start() {
    const c = cfg(); if (!configured()) return { state: 'setup' };
    if (!window.supabase || !window.supabase.createClient) return { state: 'error', message: 'The sync library did not load. Check your connection and reload.' };
    sb = window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'daybook.auth' } });
    let session = null;
    try { session = (await sb.auth.getSession()).data.session; } catch (e) { /* offline with no session */ }
    if (!session) return { state: 'signin' };
    uid = session.user.id; email = session.user.email || '';
    sb.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT' || !s) { window.dispatchEvent(new Event('daybook-signedout')); } });
    return { state: 'ready' };
  }
  async function signIn(em, pw) {
    const c = cfg(); sb = sb || window.supabase.createClient(c.url, c.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'daybook.auth' } });
    const { data, error } = await sb.auth.signInWithPassword({ email: em, password: pw });
    if (error) throw error; uid = data.user.id; email = data.user.email; return true;
  }
  async function signOut() { try { await sb.auth.signOut(); } catch (e) {} try { localStorage.removeItem(cacheKey()); } catch (e) {} uid = null; }
  async function upload(file) {
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80);
    const path = `${uid}/${Date.now().toString(36)}-${safe}`;
    const { error } = await sb.storage.from('files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw normErr(error);
    return { path, name: file.name, size: file.size, type: file.type };
  }
  async function fileUrl(path) { const { data, error } = await sb.storage.from('files').createSignedUrl(path, 3600); if (error) throw normErr(error); return data.signedUrl; }
  async function removeFile(path) { const { error } = await sb.storage.from('files').remove([path]); if (error) throw normErr(error); }
  const feedUrl = token => cfg().url + '/functions/v1/calendar?token=' + encodeURIComponent(token);
  return { cfg, configured, setCfg, clearCfg, start, signIn, signOut, loadCache, fullSync, subscribe, db, upload, fileUrl, removeFile, feedUrl, get uid() { return uid; }, get email() { return email; } };
})();
/* ===== Core: constants, state, storage, rendering infrastructure ===== */
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const T = () => L.today();
const pct = x => x == null ? '—' : Math.round(x * 100) + '%';
function lsGet(k, d) { try { const v = localStorage.getItem('daybook.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('daybook.' + k, JSON.stringify(v)); } catch (e) { /* convenience only */ } }

const COLLS = ['tasks', 'projects', 'events', 'goals', 'habits', 'groceries', 'purchases', 'pantry', 'meals', 'expenses', 'bills', 'docs', 'inbox'];
const COLL_LABEL = { tasks: 'Tasks', projects: 'Projects', events: 'Calendar', goals: 'Goals', habits: 'Habits', groceries: 'Groceries', purchases: 'Shopping trips', pantry: 'Pantry', meals: 'Meal plans', expenses: 'Expenses', bills: 'Bills', docs: 'Documents', inbox: 'Inbox' };
const P = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  brand: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4M8.5 14.5l2 2 4-4"/></svg>`,
  home: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${P}><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>`,
  cal: `<svg viewBox="0 0 24 24" ${P}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  target: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`,
  basket: `<svg viewBox="0 0 24 24" ${P}><path d="M5 10h14l-1.5 9a2 2 0 0 1-2 1.7h-7a2 2 0 0 1-2-1.7z"/><path d="M9 10l3-6 3 6"/></svg>`,
  rupee: `<svg viewBox="0 0 24 24" ${P}><path d="M7 4h11M7 9h11M7 4h3a5 5 0 0 1 0 10H7l8 7"/></svg>`,
  file: `<svg viewBox="0 0 24 24" ${P}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" ${P}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" ${P}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  more: `<svg viewBox="0 0 24 24" ${P}><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>`,
  tick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>`,
  star: `<svg viewBox="0 0 24 24" ${P}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`,
  starF: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>`,
  later: `<svg viewBox="0 0 24 24" ${P}><path d="M5 12h12M13 6l6 6-6 6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${P}><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  up: `<svg viewBox="0 0 24 24" ${P}><path d="M6 15l6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" ${P}><path d="M6 9l6 6 6-6"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" ${P}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" ${P}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>`,
  repeat: `<svg viewBox="0 0 24 24" ${P}><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>`,
  left: `<svg viewBox="0 0 24 24" ${P}><path d="M15 6l-6 6 6 6"/></svg>`,
  right: `<svg viewBox="0 0 24 24" ${P}><path d="M9 6l6 6-6 6"/></svg>`
};
const NAV = [
  { id: 'overview', label: 'Overview', icon: 'home' },
  { id: 'tasks', label: 'Tasks & Projects', short: 'Tasks', icon: 'check' },
  { id: 'calendar', label: 'Calendar & Reminders', short: 'Calendar', icon: 'cal' },
  { id: 'goals', label: 'Goals & Habits', short: 'Habits', icon: 'target' },
  { id: 'home', label: 'Home & Groceries', short: 'Home', icon: 'basket' },
  { id: 'money', label: 'Money', icon: 'rupee' },
  { id: 'docs', label: 'Documents', icon: 'file' },
  { id: 'reviews', label: 'Reviews & Analytics', short: 'Reviews', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear' }
];
const DASH = [
  { id: 'priorities', label: 'Top 3 today' }, { id: 'today', label: 'Today' }, { id: 'attention', label: 'Needs attention' },
  { id: 'upcoming', label: 'Coming up' }, { id: 'habits', label: "Today's habits" }, { id: 'goals', label: 'Goals' },
  { id: 'groceries', label: 'Groceries' }, { id: 'spending', label: 'Spending this month' }, { id: 'documents', label: 'Renewals & expiry' },
  { id: 'insight', label: 'This week' }
];
const TASK_CATS = ['Admin', 'Home', 'Health', 'Finance', 'Errands', 'Learning', 'Family', 'Meetings', 'Deep work', 'Client', 'Other'];
const EXP_CATS = ['Food & Dining', 'Groceries', 'Transport', 'Bills & Utilities', 'Rent & Housing', 'Shopping', 'Health', 'Entertainment', 'Home', 'Travel', 'Education', 'Work', 'Gifts', 'Other'];
const GROC_CATS = ['Produce', 'Dairy', 'Staples', 'Snacks', 'Household', 'Other'];
const DOC_CATS = ['Personal', 'Work', 'Receipt', 'Warranty', 'Travel', 'ID & Legal', 'Finance', 'Medical', 'Other'];
const EVENT_KINDS = { appointment: 'Appointment', block: 'Work block', reminder: 'Reminder', date: 'Important date' };
const RECUR_OPTS = [['', 'Does not repeat'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];
const REM_STATUS = { not_configured: 'Not configured', scheduled: 'Scheduled', paused: 'Paused', failed: 'Failed' };
const DEFAULT_SETTINGS = {
  theme: 'system', workDays: [1, 2, 3, 4, 5], workStart: '09:30', workEnd: '18:30',
  layout: DASH.map(d => ({ id: d.id, hidden: false, min: false })), budgets: [], digest: null
};

const S = {
  data: Object.fromEntries(COLLS.map(c => [c, new Map()])),
  settings: clone(DEFAULT_SETTINGS), settingsLoaded: false,
  scope: lsGet('scope', 'all'), view: 'overview',
  sub: lsGet('sub', { tasks: 'today', calendar: 'agenda', goals: 'habits', home: 'groceries', money: 'overview', docs: 'all', reviews: 'week' }),
  mode: 'loading', preview: false, real: null, realSettings: null,
  pending: 0, failed: [], loaded: new Set(), undo: null, dbError: null,
  calMonth: T().slice(0, 7), calSel: T(), shopping: false, mealWeek: L.weekStart(T()),
  range: { kind: 'week', anchor: T(), from: L.addDays(T(), -29), to: T() },
  taskFilter: { prio: '', cat: '', tag: '' }, projectId: null, moneyMonth: T().slice(0, 7), groupGroceriesBy: 'category'
};
const caps = { db: null };
const filesOn = () => cloudOn() && !S.offline;

/* ---------- data accessors ---------- */
const all = c => [...S.data[c].values()];
const get = (c, id) => S.data[c].get(id) || null;
const scopeOf = r => r.scope === 'work' ? 'work' : 'personal';
const inScope = r => S.scope === 'all' || scopeOf(r) === S.scope;
const live = c => all(c).filter(r => !r.archived && inScope(r));
const isOpen = t => L.OPEN(t.status || 'todo');

/* ---------- storage ---------- */
const chains = new Map();
function chain(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  chains.set(key, p);
  p.finally(() => { if (chains.get(key) === p) chains.delete(key); }).catch(() => {});
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function withRetry(fn) {
  try { return await fn(); } catch (e) {
    if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return await fn(); }
    throw e;
  }
}
function errMsg(e) {
  const c = e && e.code;
  if (c === 'quota_exceeded') return 'Storage is full. Archive and delete old records, or export a backup.';
  if (c === 'invalid_argument') return 'This record could not be saved (it may be too large, or this account cannot write here).';
  if (c === 'resource_exhausted') return 'Saving too quickly. Wait a moment, then retry.';
  if (c === 'revoked') return 'Access to storage ended. Reload the page.';
  return 'Could not reach storage. Check your connection, then retry.';
}
const cloudOn = () => S.mode === 'cloud' && !S.preview;
function persistFailed() {
  try { if (Cloud.uid) localStorage.setItem('daybook.pending.' + Cloud.uid, JSON.stringify(S.failed.map(f => ({ c: f.c, rec: f.rec, del: f.del || null, code: f.err && f.err.code })))); } catch (e) { /* best effort */ }
}
function loadFailed() {
  try { const v = JSON.parse(localStorage.getItem('daybook.pending.' + Cloud.uid) || '[]'); return Array.isArray(v) ? v.map(f => ({ c: f.c, rec: f.rec, del: f.del, err: { code: f.code } })) : []; } catch (e) { return []; }
}
const offlineFail = () => S.failed.length && S.failed.every(f => f.err && f.err.code === 'offline');
async function put(c, rec, quiet) {
  rec = clone(rec);
  rec.updatedAt = nowIso(); rec.rev = (rec.rev || 0) + 1; if (!rec.createdAt) rec.createdAt = rec.updatedAt;
  if (!rec.id) rec.id = uid();
  if (!cloudOn()) { S.data[c].set(rec.id, rec); scheduleRender(); return rec; }
  S.pending++; setStatus();
  try {
    await chain(c + '/' + rec.id, () => withRetry(() => caps.db.collection(c).doc(rec.id).set(rec)));
    S.pending--; S.failed = S.failed.filter(f => !(f.c === c && f.rec && f.rec.id === rec.id)); persistFailed(); setStatus();
    return rec;
  } catch (e) {
    S.pending--; S.failed = S.failed.filter(f => !(f.c === c && f.rec && f.rec.id === rec.id)); S.failed.push({ c, rec, err: e }); persistFailed(); setStatus();
    if (e && e.code === 'offline') { S.offline = true; if (!quiet) toast('You\'re offline. Kept on this device; it will sync when you reconnect.'); return rec; }
    if (e && e.code === 'auth') authExpired();
    toast('Save failed: ' + errMsg(e), { label: 'Retry', fn: retryFailed });
    return null;
  }
}
async function remove(c, id) {
  if (!cloudOn()) { S.data[c].delete(id); scheduleRender(); return true; }
  S.pending++; setStatus();
  try { await chain(c + '/' + id, () => withRetry(() => caps.db.collection(c).doc(id).delete())); S.pending--; setStatus(); return true; }
  catch (e) {
    S.pending--;
    if (e && e.code === 'offline') { S.data[c].delete(id); S.failed.push({ c, del: id, err: e }); persistFailed(); S.offline = true; setStatus(); scheduleRender(); return true; }
    setStatus(); toast('Delete failed: ' + errMsg(e)); return false;
  }
}
async function retryFailed() {
  const list = S.failed.slice(); S.failed = []; persistFailed();
  for (const f of list) {
    if (f.c === '__settings') await saveSettings({}, true);
    else if (f.del) await remove(f.c, f.del);
    else { const r = clone(f.rec); r.rev = (r.rev || 1) - 1; await put(f.c, r, true); }
  }
  setStatus();
}
async function saveSettings(patch, isRetry) {
  S.settings = Object.assign({}, S.settings, patch);
  applyTheme(); scheduleRender();
  if (!cloudOn()) return true;
  S.pending++; setStatus();
  const body = clone(S.settings); body.updatedAt = nowIso();
  try {
    await chain('meta/settings', () => withRetry(() => caps.db.doc('meta/settings').set(body)));
    S.pending--; S.failed = S.failed.filter(f => f.c !== '__settings'); persistFailed(); setStatus(); return true;
  } catch (e) {
    S.pending--; S.failed = S.failed.filter(f => f.c !== '__settings'); S.failed.push({ c: '__settings', rec: {}, err: e }); persistFailed(); setStatus();
    if (e && e.code === 'offline') { S.offline = true; return true; }
    toast('Settings not saved: ' + errMsg(e), { label: 'Retry', fn: retryFailed }); return false;
  }
}
function mergeSettings(v) {
  const s = Object.assign(clone(DEFAULT_SETTINGS), v ? clone(v) : {});
  const known = new Set(s.layout.map(x => x.id));
  DASH.forEach(d => { if (!known.has(d.id)) s.layout.push({ id: d.id, hidden: false, min: false }); });
  s.layout = s.layout.filter(x => DASH.some(d => d.id === x.id));
  return s;
}
async function initStore() {
  S.mode = 'loading'; setStatus();
  let r;
  try { r = await Cloud.start(); } catch (e) { r = { state: 'error', message: String(e.message || e) }; }
  if (r.state !== 'ready') { S.mode = r.state; S.gateError = r.message || ''; setStatus(); render(); return; }
  startSync();
}
let syncStarted = false;
function startSync() {
  S.mode = 'cloud'; caps.db = Cloud.db; S.synced = false; S.gateError = '';
  if (!syncStarted) {
    syncStarted = true;
    for (const c of COLLS) {
      Cloud.db.collection(c).onSnapshot(snap => {
        const m = new Map();
        snap.docs.forEach(d => { if (d.exists) m.set(d.id, Object.assign({}, d.data(), { id: d.id })); });
        if (S.preview) S.real[c] = m; else S.data[c] = m;
        S.loaded.add(c); setStatus(); scheduleRender();
      });
    }
    Cloud.db.doc('meta/settings').onSnapshot(snap => {
      const v = mergeSettings(snap.exists ? snap.data() : null);
      if (S.preview) S.realSettings = v; else { S.settings = v; applyTheme(); }
      S.settingsLoaded = true; S.loaded.add('settings'); setStatus(); scheduleRender();
    });
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => { S.offline = true; setStatus(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (S.lastSync || 0) > 60000) syncNow(); });
    window.addEventListener('daybook-signedout', () => { if (S.mode === 'cloud') { S.mode = 'signin'; render(); } });
  }
  Cloud.loadCache();
  S.failed = loadFailed();
  Cloud.subscribe(st => { S.rt = st; setStatus(); });
  syncNow();
  render();
}
async function syncNow() {
  if (S.mode !== 'cloud') return;
  if (!navigator.onLine) { S.offline = true; setStatus(); return; }
  S.offline = false; setStatus();
  try {
    if (S.failed.length) await retryFailed();
    if (!S.failed.length) { await Cloud.fullSync(); S.synced = true; S.lastSync = Date.now(); S.dbError = null; }
  } catch (e) {
    if (e && e.code === 'offline') S.offline = true;
    else if (e && e.code === 'auth') authExpired();
    else S.dbError = 'Could not sync with your database (' + (e && e.message || 'error') + '). Showing the copy saved on this device.';
  }
  setStatus(); scheduleRender();
}
function authExpired() { S.dbError = 'Your sign-in has expired. Sign in again to keep syncing; nothing on this device is lost.'; S.authExpired = true; setStatus(); scheduleRender(); }
const allLoaded = () => S.loaded.size >= COLLS.length + 1;

/* ---------- status, toast, theme ---------- */
function setStatus() {
  const b = $('#save-status'); if (!b) return;
  let s, t;
  const waiting = S.failed.length;
  if (S.preview) { s = 'preview'; t = 'Preview · not saved'; }
  else if (S.mode === 'setup' || S.mode === 'signin' || S.mode === 'error') { s = 'offline'; t = 'Not signed in'; }
  else if (S.mode === 'loading') { s = 'loading'; t = 'Connecting…'; }
  else if (S.offline || offlineFail()) { s = 'offline'; t = waiting ? `Offline · ${waiting} waiting` : 'Offline'; }
  else if (waiting) { s = 'failed'; t = 'Save failed · Retry'; }
  else if (S.dbError) { s = 'failed'; t = S.authExpired ? 'Sign in again' : 'Sync problem'; }
  else if (S.pending > 0) { s = 'saving'; t = 'Saving…'; }
  else if (!S.synced || !allLoaded()) { s = 'loading'; t = 'Syncing…'; }
  else { s = 'saved'; t = 'Synced'; }
  b.dataset.s = s; b.querySelector('span').textContent = t;
  b.title = s === 'saved' ? 'All changes are saved to your private database and synced across your devices.' : t;
}
let toastTimer = null;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button" id="toast-act">${esc(action.label)}</button>` : '');
  el.hidden = false;
  if (action) $('#toast-act').onclick = () => { el.hidden = true; action.fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, action ? 7000 : 3200);
}
function applyTheme() {
  const t = S.settings.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  lsSet('theme', t);
}

/* ---------- undo ---------- */
function offerUndo(label, ops) {
  S.undo = ops;
  toast(label, { label: 'Undo', fn: async () => {
    const o = S.undo; S.undo = null; if (!o) return;
    for (const op of o) {
      if (op.before) { const cur = get(op.c, op.before.id); const r = clone(op.before); r.rev = cur ? cur.rev : r.rev; await put(op.c, r); }
      else if (op.createdId) await remove(op.c, op.createdId);
    }
    toast('Undone');
  } });
}

/* ---------- render loop ---------- */
let rq = false;
function scheduleRender() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(); }); }
function render() {
  const ae = document.activeElement; let keep = null;
  if (ae && ae.id && $('#view').contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) {
    keep = { id: ae.id, v: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
  }
  const nav = NAV.find(n => n.id === S.view) || NAV[0];
  $('#view-title').textContent = nav.label;
  $('#view-sub').textContent = viewSub();
  document.querySelectorAll('[data-seg="scope"] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.scope)));
  $('#side-nav').innerHTML = NAV.map(n => `<button type="button" class="nav-btn" style="--c:var(--c-${n.id})" data-act="nav" data-v="${n.id}" ${n.id === S.view ? 'aria-current="page"' : ''}><span class="nav-ic">${ICON[n.icon]}</span><span>${esc(n.label)}</span>${navBadge(n.id)}</button>`).join('');
  $('#view').style.setProperty('--sec', 'var(--c-' + nav.id + ')');
  const tabs = ['overview', 'tasks', 'calendar', 'home'];
  const moreActive = !tabs.includes(S.view);
  $('#tabbar').innerHTML = tabs.map(id => { const n = NAV.find(x => x.id === id); return `<button type="button" style="--c:var(--c-${id})" data-act="nav" data-v="${id}" ${id === S.view ? 'aria-current="page"' : ''}><span class="nav-ic">${ICON[n.icon]}</span><span>${esc(n.short || n.label)}</span></button>`; }).join('') +
    `<button type="button" style="--c:var(--c-${moreActive ? nav.id : 'settings'})" data-act="more-nav" ${moreActive ? 'aria-current="page"' : ''}><span class="nav-ic">${moreActive ? ICON[nav.icon] : ICON.more}</span><span>${moreActive ? esc(nav.short || nav.label) : 'More'}</span></button>`;
  $('#banner').innerHTML = bannerHtml();
  const gated = !S.preview && ['setup', 'signin', 'error'].includes(S.mode);
  document.body.classList.toggle('gated', gated);
  if (gated) { $('#view').innerHTML = gateHtml(); $('#view-title').textContent = 'Daybook'; return; }
  const fn = VIEWS[S.view] || VIEWS.overview;
  let html = '';
  try { html = fn(); } catch (e) { console.error(e); html = `<div class="note err">This section hit an error: ${esc(e.message)}. Your data is unaffected. Try another section or reload.</div>`; }
  $('#view').innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); if (el.value !== keep.v) el.value = keep.v; try { el.setSelectionRange(keep.s, keep.e); } catch (e) {} el.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  if (S.shopping) renderShopping();
}
function viewSub() {
  const t = T();
  if (S.view === 'overview') { const p = L.istParts(); return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][L.dow(t)] + ', ' + L.fmtDate(t) + ' · ' + L.fmtTime(p.time) + ' IST'; }
  return L.fmtDate(t);
}
function navBadge(id) {
  if (id === 'tasks') { const n = live('tasks').filter(t => isOpen(t) && L.isDate(t.due) && t.due < T()).length; return n ? `<span class="badge alert" title="Overdue tasks">${n}</span>` : ''; }
  if (id === 'home') { const n = live('groceries').filter(g => g.status !== 'bought').length; return n ? `<span class="badge" title="Groceries needed">${n}</span>` : ''; }
  return '';
}
function bannerHtml() {
  const out = [];
  if (S.preview) out.push(`<div class="note warn"><b>Preview with sample data.</b><span>Nothing you do here is saved. Your real planner is untouched.</span><button class="btn sm" data-act="exit-preview">Exit preview</button></div>`);
  else if (S.mode === 'cloud' && S.offline) out.push(`<div class="note warn"><b>Offline.</b><span>You can keep working. Changes are kept on this device and sync when you reconnect${S.failed.length ? ` (${S.failed.length} waiting)` : ''}.</span></div>`);
  if (S.dbError && !S.preview && S.mode === 'cloud') out.push(`<div class="note err"><span>${esc(S.dbError)}</span>${S.authExpired ? '<button class="btn sm" data-act="resignin">Sign in</button>' : '<button class="btn sm" data-act="status">Try again</button>'}</div>`);
  return out.join('');
}
function gateHtml() {
  const c = Cloud.cfg();
  const err = `<div class="err small" id="gate-err" ${S.gateError ? '' : 'hidden'} role="alert">${esc(S.gateError || '')}</div>`;
  const pv = `<button type="button" class="btn ghost" data-act="gate-preview">Explore with sample data</button>`;
  if (S.mode === 'setup' || (S.mode === 'error' && !Cloud.configured())) return `<div class="gate"><div class="gate-card"><div class="gate-mark">${ICON.brand}</div><h2>Connect your database</h2>
    <p class="muted">Daybook stores your data in your own free Supabase project, so it syncs between your PC and iPhone and nobody else can read it. The setup guide shows where to find these two values.</p>
    <form class="stack" data-form="gate-setup" novalidate><label class="field"><span>Project URL</span><input type="url" name="url" id="g-url" value="${esc(c.url)}" placeholder="https://xxxx.supabase.co" autocomplete="off" required></label>
    <label class="field"><span>Publishable (anon) key</span><input type="text" name="key" id="g-key" value="${esc(c.key)}" placeholder="sb_publishable_… or eyJ…" autocomplete="off" required></label>${err}
    <button class="btn primary big" type="submit">Continue</button></form><div class="gate-foot">${pv}</div></div></div>`;
  if (S.mode === 'error') return `<div class="gate"><div class="gate-card"><h2>Couldn't start</h2><p class="muted">${esc(S.gateError)}</p><button class="btn primary" onclick="location.reload()">Reload</button><div class="gate-foot">${pv}</div></div></div>`;
  return `<div class="gate"><div class="gate-card"><div class="gate-mark">${ICON.brand}</div><h2>Welcome back</h2><p class="muted">Sign in with the account you created in Supabase.</p>
    <form class="stack" data-form="gate-signin" novalidate><label class="field"><span>Email</span><input type="email" name="email" id="g-email" autocomplete="username" required inputmode="email"></label>
    <label class="field"><span>Password</span><input type="password" name="password" id="g-pw" autocomplete="current-password" required></label>${err}
    <button class="btn primary big" type="submit">Sign in</button></form>
    <div class="gate-foot">${pv}<button type="button" class="btn ghost" data-act="gate-reset">Change database</button></div></div></div>`;
}
/* ---------- small html helpers ---------- */
const scopePill = r => S.scope === 'all' ? `<span class="pill ${scopeOf(r)}">${scopeOf(r) === 'work' ? 'Work' : 'Personal'}</span>` : '';
const dotFor = r => `<span class="dot ${scopeOf(r)}" title="${scopeOf(r) === 'work' ? 'Work' : 'Personal'}"></span>`;
function dueLabel(t) {
  if (!L.isDate(t.due)) return '';
  const td = T(); const over = isOpen(t) && (t.due < td || (t.due === td && L.isTime(t.dueTime) && t.dueTime < L.nowTime()));
  const txt = L.relDay(t.due) + (L.isTime(t.dueTime) ? ' ' + L.fmtTime(t.dueTime) : '');
  return over ? `<span class="pill over">Overdue · ${esc(txt)}</span>` : `<span>${esc(txt)}</span>`;
}
function feedState() {
  const f = S.settings.feed || {};
  if (!f.token) return 'not_configured';
  if (f.enabled === false) return 'paused';
  if (f.lastTest && !f.lastTest.ok) return 'failed';
  if (!(f.lastTest && f.lastTest.ok) || !(f.subscribedOn || []).length) return 'not_configured';
  return 'scheduled';
}
const remState = rem => rem && rem.at ? feedState() : null;
function remPill(rem) {
  if (!rem || !rem.at) return '';
  const st = remState(rem);
  return `<span class="pill ${st === 'not_configured' ? '' : st}" title="Reminder: ${esc(REM_STATUS[st])}">${ICON.bell.replace('<svg', '<svg width="11" height="11"')} ${esc(REM_STATUS[st])}</span>`;
}
const CARD_IC = { priorities: ['star', 'overview'], today: ['check', 'tasks'], attention: ['bell', 'overview'], upcoming: ['cal', 'calendar'], habits: ['target', 'goals'], goals: ['target', 'goals'], groceries: ['basket', 'home'], spending: ['rupee', 'money'], documents: ['file', 'docs'], insight: ['chart', 'reviews'] };
function ring(frac, color, size, label) {
  size = size || 46; const sw = 5, r = (size - sw) / 2, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--sunk)" stroke-width="${sw}"/><circle class="fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - f)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>${label ? `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>` : ''}</svg>`;
}
function card(id, title, body, opts = {}) {
  const lay = (S.settings.layout || []).find(x => x.id === id) || {};
  return `<section class="card ${lay.min ? 'min' : ''} ${opts.wide ? 'wide' : ''}" aria-label="${esc(title)}">
    <div class="card-h">${CARD_IC[id] ? `<span class="chip-ic" style="--c:var(--c-${CARD_IC[id][1]})">${ICON[CARD_IC[id][0]]}</span>` : ''}<h2>${opts.go ? `<button class="link" style="text-decoration:none;color:inherit;font:inherit;letter-spacing:inherit" data-act="go" data-v="${opts.go}">${esc(title)}</button>` : esc(title)}</h2>${opts.count != null ? `<span class="badge ${opts.alert ? 'alert' : ''}">${opts.count}</span>` : ''}
      <div class="more">${opts.go ? `<button class="icon-btn" data-act="go" data-v="${opts.go}" aria-label="Open ${esc(title)}">${ICON.right}</button>` : ''}<button class="icon-btn" data-act="dash-min" data-v="${id}" aria-label="${lay.min ? 'Expand' : 'Minimise'} ${esc(title)}" aria-expanded="${!lay.min}">${lay.min ? ICON.down : ICON.up}</button></div></div>
    <div class="card-b">${body}</div></section>`;
}
function taskRow(t, o = {}) {
  const done = t.status === 'done'; const proj = t.projectId ? get('projects', t.projectId) : null;
  const subs = (t.subtasks || []); const sd = subs.filter(s => s.done).length;
  const focus = t.focus === T();
  return `<div class="row ${done ? 'done' : ''}">
    <button class="chk" role="checkbox" aria-checked="${done}" data-act="toggle-task" data-id="${esc(t.id)}" aria-label="${done ? 'Mark not done' : 'Complete'}: ${esc(t.title)}">${ICON.tick}</button>
    <button class="row-main" data-act="edit" data-c="tasks" data-id="${esc(t.id)}">
      <span class="row-title">${dotFor(t)}${esc(t.title)}</span>
      <span class="row-sub">${t.priority === 'high' ? '<span class="prio-high">High</span>' : t.priority === 'med' ? '<span class="prio-med">Medium</span>' : ''}${o.done ? `<span>Done ${esc(L.fmtStamp(t.completedAt))}</span>` : dueLabel(t)}${proj ? `<span>${esc(proj.name)}</span>` : ''}${t.category ? `<span>${esc(t.category)}</span>` : ''}${subs.length ? `<span>${sd}/${subs.length} steps</span>` : ''}${t.recur && t.recur.freq ? `<span title="Repeats ${esc(t.recur.freq)}">↻ ${esc(t.recur.freq)}</span>` : ''}${t.estMin ? `<span>${t.estMin} min</span>` : ''}${remPill(t.reminder)}</span>
    </button>
    ${!done && !o.noActions ? `<button class="icon-btn" data-act="focus" data-id="${esc(t.id)}" aria-pressed="${focus}" aria-label="${focus ? 'Unpin from' : 'Pin to'} today's top 3" title="${focus ? 'Unpin from' : 'Pin to'} top 3">${focus ? ICON.starF : ICON.star}</button>
    <button class="icon-btn" data-act="postpone" data-id="${esc(t.id)}" aria-label="Move to tomorrow" title="Move to tomorrow">${ICON.later}</button>` : ''}
  </div>`;
}
function emptyState(text, act) { return `<div class="empty">${text}${act ? ` <button class="link" data-act="${act[0]}" ${act[2] || ''}>${esc(act[1])}</button>` : ''}</div>`; }
function bar(frac, cls) { const w = Math.max(0, Math.min(1, frac || 0)) * 100; return `<div class="bar ${cls || ''}" role="img" aria-label="${Math.round(w)}%"><i style="width:${w}%"></i></div>`; }
function tabsHtml(key, items) {
  return `<div class="tabs" role="group" aria-label="Views">${items.map(([v, l, n]) => `<button type="button" data-act="sub" data-k="${key}" data-v="${v}" aria-pressed="${S.sub[key] === v}">${esc(l)}${n ? ` <span class="badge">${n}</span>` : ''}</button>`).join('')}</div>`;
}
function opts(list, val, blank) {
  return (blank != null ? `<option value="">${esc(blank)}</option>` : '') + list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(val ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
}
/* ===== Views ===== */
const KIND_LABEL = { deadline: 'Due', appointment: 'Appt', block: 'Work block', reminder: 'Reminder', date: 'Date', bill: 'Bill', expiry: 'Expires', renewal: 'Renew', milestone: 'Milestone', project: 'Deadline', goal: 'Goal' };
function agendaItems(from, to) {
  const out = [];
  live('tasks').forEach(t => {
    if (L.isDate(t.due) && t.due >= from && t.due <= to && t.status !== 'cancelled') out.push({ date: t.due, time: t.dueTime || '', kind: 'deadline', title: t.title, r: t, c: 'tasks', done: t.status === 'done' });
    if (t.reminder && t.reminder.at && isOpen(t)) { const d = t.reminder.at.slice(0, 10); if (d >= from && d <= to) out.push({ date: d, time: t.reminder.at.slice(11, 16), kind: 'reminder', title: t.title, r: t, c: 'tasks' }); }
  });
  live('events').forEach(e => L.occurrences(e, from, to).forEach(d => out.push({ date: d, time: e.allDay ? '' : (e.start || ''), end: e.end, kind: e.kind || 'appointment', title: e.title, r: e, c: 'events' })));
  live('bills').forEach(b => L.billProjection(b, from, to).filter(d => d >= from || from <= T()).forEach(d => out.push({ date: d, time: '', kind: 'bill', title: `${b.name} · ${L.money(b.amount)}`, r: b, c: 'bills', overdue: d < T() })));
  live('docs').forEach(d => {
    if (L.isDate(d.expiry) && d.expiry >= from && d.expiry <= to) out.push({ date: d.expiry, time: '', kind: 'expiry', title: d.title, r: d, c: 'docs' });
    if (L.isDate(d.renewal) && d.renewal >= from && d.renewal <= to) out.push({ date: d.renewal, time: '', kind: 'renewal', title: d.title, r: d, c: 'docs' });
  });
  live('projects').forEach(p => {
    if (L.isDate(p.deadline) && p.deadline >= from && p.deadline <= to && p.status !== 'done') out.push({ date: p.deadline, time: '', kind: 'project', title: p.name, r: p, c: 'projects' });
    (p.milestones || []).forEach(m => { if (!m.done && L.isDate(m.due) && m.due >= from && m.due <= to) out.push({ date: m.due, time: '', kind: 'milestone', title: `${m.title} (${p.name})`, r: p, c: 'projects' }); });
  });
  live('goals').forEach(g => { if (g.status !== 'done' && L.isDate(g.targetDate) && g.targetDate >= from && g.targetDate <= to) out.push({ date: g.targetDate, time: '', kind: 'goal', title: g.title, r: g, c: 'goals' }); });
  return out.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
function agendaRow(it) {
  const tm = it.time ? L.fmtTime(it.time) + (it.end ? '–' + L.fmtTime(it.end) : '') : '';
  return `<div class="row ${it.done ? 'done' : ''}"><span class="kind">${esc(KIND_LABEL[it.kind] || it.kind)}</span>
    <button class="row-main" data-act="edit" data-c="${it.c}" data-id="${esc(it.r.id)}"><span class="row-title">${esc(it.title)}</span>
    <span class="row-sub">${dotFor(it.r)}${tm ? `<span>${esc(tm)}</span>` : ''}${it.overdue ? '<span class="pill over">Overdue</span>' : ''}${it.r.location ? `<span>${esc(it.r.location)}</span>` : ''}${it.kind === 'reminder' || (it.c === 'events' && it.r.reminder) ? remPill(it.r.reminder) : ''}${scopePill(it.r)}</span></button></div>`;
}

/* ---------- Overview ---------- */
const DASH_RENDER = {
  priorities() {
    const td = T(); const open = live('tasks').filter(isOpen);
    const pinned = open.filter(t => t.focus === td).slice(0, 3);
    let body = pinned.map(t => taskRow(t)).join('');
    if (pinned.length < 3) {
      const rank = { high: 0, med: 1, low: 2 };
      const cands = open.filter(t => t.focus !== td && ((L.isDate(t.due) && t.due <= L.addDays(td, 1)) || t.priority === 'high'))
        .sort((a, b) => (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) || String(a.due || '9').localeCompare(String(b.due || '9'))).slice(0, 3 - pinned.length);
      if (!pinned.length && !cands.length) body = emptyState('Pin up to three tasks with the star to focus your day.', ['go', 'Open tasks', 'data-v="tasks:today"']);
      else if (cands.length) body += `<div class="small muted" style="margin-top:8px">Suggested from due dates and priority. Tap ☆ to pin.</div><div class="list">${cands.map(t => taskRow(t)).join('')}</div>`;
    }
    return card('priorities', 'Top 3 today', `<div class="list">${body}</div>`, { go: 'tasks:today', count: pinned.length + '/3' });
  },
  today() {
    const td = T(); const open = live('tasks').filter(isOpen);
    const over = open.filter(t => L.isDate(t.due) && t.due < td).sort((a, b) => a.due.localeCompare(b.due));
    const items = agendaItems(td, td).filter(i => !(i.kind === 'deadline' && i.done));
    const timed = items.filter(i => i.kind !== 'deadline').map(agendaRow);
    const dueToday = items.filter(i => i.kind === 'deadline').map(i => taskRow(i.r));
    let body = '';
    if (over.length) body += `<div class="small" style="color:var(--danger);font-weight:700;margin-top:4px">Overdue · ${over.length}</div><div class="list">${over.slice(0, 4).map(t => taskRow(t)).join('')}</div>${over.length > 4 ? `<button class="link small" data-act="go" data-v="tasks:overdue">See all ${over.length} overdue</button>` : ''}`;
    if (timed.length) body += `<div class="small muted" style="font-weight:700;margin-top:8px">Schedule</div><div class="list">${timed.join('')}</div>`;
    if (dueToday.length) body += `<div class="small muted" style="font-weight:700;margin-top:8px">Due today</div><div class="list">${dueToday.join('')}</div>`;
    if (!body) body = emptyState('Nothing scheduled or due today.', ['quick-add', 'Add a task']);
    return card('today', 'Today', body, { go: 'calendar:agenda', count: over.length + dueToday.length + timed.length, alert: over.length > 0 });
  },
  attention() {
    const td = T(); const lines = [];
    const over = live('tasks').filter(t => isOpen(t) && L.isDate(t.due) && t.due < td).length;
    if (over) lines.push([`${over} overdue task${over > 1 ? 's' : ''}`, 'tasks:overdue', 'over']);
    const ob = live('bills').filter(b => L.billState(b).key === 'overdue');
    if (ob.length) lines.push([`${ob.length} overdue bill${ob.length > 1 ? 's' : ''} · ${L.money(ob.reduce((s, b) => s + (+b.amount || 0), 0))}`, 'money:bills', 'over']);
    const db = live('bills').filter(b => L.billState(b).key === 'due');
    if (db.length) lines.push([`${db.length} bill${db.length > 1 ? 's' : ''} due within 7 days`, 'money:bills', 'soon']);
    const exp = live('docs').filter(d => [d.expiry, d.renewal].some(x => L.isDate(x) && x <= L.addDays(td, 30)));
    if (exp.length) lines.push([`${exp.length} document${exp.length > 1 ? 's' : ''} expiring or due for renewal within 30 days`, 'docs:expiring', exp.some(d => [d.expiry, d.renewal].some(x => L.isDate(x) && x < td)) ? 'over' : 'soon']);
    const inbox = all('inbox').filter(i => !i.archived).length;
    if (inbox) lines.push([`${inbox} inbox item${inbox > 1 ? 's' : ''} to organise`, 'tasks:inbox', '']);
    const remPassed = live('tasks').filter(t => isOpen(t) && t.reminder && t.reminder.at && (t.reminder.status || 'not_configured') !== 'scheduled' && t.reminder.at.slice(0, 10) <= td).length;
    if (remPassed) lines.push([`${remPassed} reminder${remPassed > 1 ? 's' : ''} due but not scheduled (no notification was sent)`, 'calendar:reminders', 'soon']);
    const failed = [...live('tasks'), ...live('events')].filter(r => r.reminder && r.reminder.status === 'failed').length;
    if (failed) lines.push([`${failed} reminder${failed > 1 ? 's' : ''} marked failed`, 'calendar:reminders', 'over']);
    const projSoon = live('projects').filter(p => p.status !== 'done' && L.isDate(p.deadline) && p.deadline <= L.addDays(td, 7));
    if (projSoon.length) lines.push([`${projSoon.length} project deadline${projSoon.length > 1 ? 's' : ''} within 7 days`, 'tasks:projects', 'soon']);
    if (S.failed.length) lines.unshift([`${S.failed.length} change${S.failed.length > 1 ? 's' : ''} not saved`, 'retry', 'over']);
    const body = lines.length ? `<div class="list">${lines.map(([t, go, cls]) => `<div class="row"><span class="dot" style="background:var(--${cls === 'over' ? 'danger' : cls === 'soon' ? 'warn' : 'faint'})"></span><button class="row-main" data-act="${go === 'retry' ? 'status' : 'go'}" data-v="${go}"><span class="row-title">${esc(t)}</span></button></div>`).join('')}</div>` : emptyState('Nothing needs attention right now.');
    return card('attention', 'Needs attention', body, { count: lines.length, alert: lines.some(l => l[2] === 'over') });
  },
  upcoming() {
    const td = T(); const items = agendaItems(L.addDays(td, 1), L.addDays(td, 14)).filter(i => !i.done);
    if (!items.length) return card('upcoming', 'Coming up', emptyState('Nothing in the next 14 days.'), { go: 'calendar:agenda' });
    let last = ''; let html = '';
    items.slice(0, 9).forEach(i => { if (i.date !== last) { html += `<div class="small muted" style="font-weight:700;margin-top:8px">${esc(L.relDay(i.date))}</div>`; last = i.date; } html += agendaRow(i); });
    if (items.length > 9) html += `<button class="link small" data-act="go" data-v="calendar:agenda">${items.length - 9} more in the next 14 days</button>`;
    return card('upcoming', 'Coming up', html, { go: 'calendar:agenda', count: items.length });
  },
  habits() {
    const td = T(); const hs = live('habits').filter(h => L.habitScheduled(h, td));
    const body = hs.length ? hs.map(h => habitTodayRow(h)).join('') : emptyState(live('habits').length ? 'No habits scheduled today.' : 'No habits yet.', ['new', 'Add a habit', 'data-c="habits"']);
    const done = hs.filter(h => (h.log || {})[td] === 'done').length;
    return card('habits', "Today's habits", body, { go: 'goals:habits', count: hs.length ? `${done}/${hs.length}` : null });
  },
  goals() {
    const gs = live('goals').filter(g => g.status !== 'done').slice(0, 4);
    const body = gs.length ? gs.map(g => { const p = L.goalProgress(g); return `<div class="row"><button class="row-main" data-act="edit" data-c="goals" data-id="${esc(g.id)}"><span class="row-title">${esc(g.title)}</span>
      <span class="row-sub">${dotFor(g)}${p ? `<span>${esc(p.label)}</span>` : '<span>No measure set</span>'}${g.targetDate ? `<span>by ${esc(L.fmtDate(g.targetDate))}</span>` : ''}</span>
      ${p ? `<span style="margin-top:6px">${bar(p.pct, scopeOf(g))}</span>` : ''}${g.nextAction ? `<span class="row-sub" style="margin-top:4px">Next: ${esc(g.nextAction)}</span>` : ''}</button></div>`; }).join('') : emptyState('No active goals.', ['new', 'Add a goal', 'data-c="goals"']);
    return card('goals', 'Goals', `<div class="list">${body}</div>`, { go: 'goals:goals' });
  },
  groceries() {
    const need = live('groceries').filter(g => g.status !== 'bought');
    const body = need.length ? `<div class="list">${need.slice(0, 6).map(g => groceryRow(g, true)).join('')}</div>${need.length > 6 ? `<div class="small muted">+${need.length - 6} more</div>` : ''}<div class="hstack" style="margin-top:10px"><button class="btn sm" data-act="shop">Start shopping</button></div>` : emptyState('Grocery list is empty.', ['go', 'Add items', 'data-v="home:groceries"']);
    return card('groceries', 'Groceries', body, { go: 'home:groceries', count: need.length || null });
  },
  spending() {
    const td = T(); const ms = L.monthStart(td);
    const st = L.spendStats(live('expenses'), ms, td);
    const budget = budgetsInScope().reduce((s, b) => s + (+b.amount || 0), 0);
    if (!st.count && !budget) return card('spending', 'Spending this month', emptyState('No expenses recorded this month.', ['new', 'Record an expense', 'data-c="expenses"']), { go: 'money:overview' });
    const body = `<div class="hstack" style="justify-content:space-between;align-items:baseline"><b class="num" style="font-size:24px;font-weight:600">${L.money(st.total)}</b><span class="small muted">${budget ? 'of ' + L.money(budget) + ' budget' : 'No budget set'}</span></div>
      ${budget ? `<div style="margin:8px 0">${bar(st.total / budget, st.total > budget ? 'over' : '')}</div><div class="small muted">${st.total > budget ? `${L.money(st.total - budget)} over budget` : `${L.money(budget - st.total)} left · day ${L.diffDays(ms, td) + 1} of ${L.diffDays(ms, L.monthEnd(td)) + 1}`}</div>` : ''}
      ${st.byCat.length ? `<table class="tbl" style="margin-top:8px"><tbody>${st.byCat.slice(0, 3).map(r => `<tr><td>${esc(r.key)}</td><td class="r">${L.money(r.value)}</td></tr>`).join('')}</tbody></table>` : ''}`;
    return card('spending', 'Spending this month', body, { go: 'money:overview' });
  },
  documents() {
    const td = T(); const lim = L.addDays(td, 60);
    const rows = [];
    live('docs').forEach(d => { [['expiry', 'Expires'], ['renewal', 'Renew by']].forEach(([k, l]) => { if (L.isDate(d[k]) && d[k] <= lim) rows.push({ d, date: d[k], l }); }); });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const body = rows.length ? `<div class="list">${rows.slice(0, 5).map(x => `<div class="row"><button class="row-main" data-act="edit" data-c="docs" data-id="${esc(x.d.id)}"><span class="row-title">${esc(x.d.title)}</span><span class="row-sub">${dotFor(x.d)}${x.date < td ? `<span class="pill over">${x.l === 'Expires' ? 'Expired' : 'Renewal overdue'} ${esc(L.fmtDate(x.date))}</span>` : `<span class="${L.diffDays(td, x.date) <= 30 ? 'pill soon' : ''}">${x.l} ${esc(L.fmtDate(x.date))}</span>`}</span></button></div>`).join('')}</div>` : emptyState('Nothing expiring in the next 60 days.');
    return card('documents', 'Renewals & expiry', body, { go: 'docs:expiring', count: rows.length || null });
  },
  insight() { return card('insight', 'This week', weeklyFacts(true), { go: 'reviews:week' }); }
};
function weeklyFacts(compact) {
  const td = T(); const ws = L.weekStart(td); const pws = L.addDays(ws, -7), pwe = L.addDays(ws, -1);
  const tasks = live('tasks'); const a = L.taskStats(tasks, ws, td), b = L.taskStats(tasks, pws, pwe);
  const facts = [];
  if (a.completed || b.completed) facts.push(`${a.completed} task${a.completed === 1 ? '' : 's'} completed this week${b.completed || a.completed ? ` (last week: ${b.completed})` : ''}.`);
  if (a.onTimeRate != null) facts.push(`${pct(a.onTimeRate)} of dated tasks finished on time (${a.onTime} of ${a.withDue}).`);
  if (a.overdueNow) facts.push(`${a.overdueNow} task${a.overdueNow > 1 ? 's are' : ' is'} overdue right now.`);
  const hs = live('habits'); let hd = 0, hsch = 0;
  hs.forEach(h => { const s = L.habitStats(h, ws, td); hd += s.done; hsch += s.scheduled; });
  if (hsch) facts.push(`Habits: ${hd} done of ${hsch} scheduled check-ins so far this week.`);
  const sp = L.spendStats(live('expenses'), ws, td), spp = L.spendStats(live('expenses'), pws, pwe);
  if (sp.count || spp.count) facts.push(`Spent ${L.money(sp.total)} this week (last week: ${L.money(spp.total)}).`);
  if (!facts.length) return `<div class="empty">Not enough data yet. Insights appear once you complete tasks, log habits or record expenses.</div>`;
  return `<ul class="facts" style="margin:0;padding-left:18px">${facts.slice(0, compact ? 3 : 10).map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
}
function habitTodayRow(h, date) {
  date = date || T(); const v = (h.log || {})[date] || '';
  const lbl = v === 'done' ? 'Done' : v === 'skip' ? 'Skipped' : 'Mark done';
  const s = L.habitStats(h, L.addDays(T(), -29), T());
  return `<div class="habit-row"><button class="row-main" data-act="edit" data-c="habits" data-id="${esc(h.id)}"><span class="row-title">${esc(h.title)}</span><span class="row-sub">${dotFor(h)}${s.streak ? `<span>${s.streak}-day streak</span>` : ''}<span>${esc(habitDaysLabel(h))}</span></span></button>
    <button class="habit-tap" data-act="habit-tap" data-id="${esc(h.id)}" data-d="${date}" data-v="${v}" aria-label="${esc(h.title)}: ${lbl}. Tap to change.">${lbl}</button></div>`;
}
function habitDaysLabel(h) { if (!h.days || !h.days.length || h.days.length === 7) return 'Daily'; return h.days.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => L.WD[d]).join(' '); }

function heroHtml() {
  const td = T(); const h = +L.istParts().time.slice(0, 2);
  const greet = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const open = live('tasks').filter(isOpen);
  const due = open.filter(t => L.isDate(t.due) && t.due <= td).length, over = open.filter(t => L.isDate(t.due) && t.due < td).length;
  const doneToday = live('tasks').filter(t => t.status === 'done' && L.istDateOf(t.completedAt) === td).length;
  const hs = live('habits').filter(x => L.habitScheduled(x, td)); const hd = hs.filter(x => (x.log || {})[td] === 'done').length;
  const sp = L.spendStats(live('expenses'), L.monthStart(td), td).total; const bud = budgetsInScope().reduce((s, b) => s + (+b.amount || 0), 0);
  const groc = live('groceries').filter(g => g.status !== 'bought').length, gotN = live('groceries').filter(g => g.status === 'bought').length;
  const tile = (go, c, frac, lbl, big, small) => `<button class="tile" style="--c:var(--c-${c})" data-act="go" data-v="${go}">${ring(frac, `var(--c-${c})`, 46, lbl)}<span style="min-width:0"><b>${big}</b><span>${small}</span></span></button>`;
  return `<p class="greet">${greet}. Here's your day.</p><div class="hero">
    ${tile('tasks:today', 'tasks', due + doneToday ? doneToday / (due + doneToday) : 0, '', due, over ? `due · <span style="color:var(--danger)">${over} overdue</span>` : 'due today')}
    ${tile('goals:habits', 'goals', hs.length ? hd / hs.length : 0, '', `${hd}/${hs.length}`, 'habits done')}
    ${tile('money:overview', 'money', bud ? sp / bud : 0, '', L.money(sp).replace('.00', ''), bud ? `of ${L.money(bud)} budget` : 'spent this month')}
    ${tile('home:groceries', 'home', groc + gotN ? gotN / (groc + gotN) : 0, '', groc, 'groceries needed')}</div>`;
}
const VIEWS = {};
VIEWS.overview = () => {
  const lay = S.settings.layout || DEFAULT_SETTINGS.layout;
  const loading = !S.preview && (S.mode === 'loading' || (S.mode === 'cloud' && !allLoaded()));
  const cards = lay.filter(x => !x.hidden && DASH_RENDER[x.id]).map(x => DASH_RENDER[x.id]()).join('');
  const isEmpty = !S.preview && COLLS.every(c => S.data[c].size === 0);
  return heroHtml() + (loading ? `<div class="note" style="margin-bottom:14px">Loading your planner…</div>` : '') +
    (isEmpty && !loading ? `<div class="note" style="margin-bottom:14px"><span><b>Your planner is empty.</b> Use Quick add to capture your first task, expense or grocery item. Want to look around first?</span><button class="btn sm" data-act="enter-preview">Preview with sample data</button></div>` : '') +
    `<div class="grid">${cards || emptyState('All dashboard sections are hidden.', ['go', 'Choose sections in Settings', 'data-v="settings"'])}</div>
    <div class="hstack small muted" style="margin-top:14px"><button class="btn ghost sm" data-act="go" data-v="settings:layout">Arrange dashboard</button></div>`;
};

/* ---------- Tasks & Projects ---------- */
function taskFilterFn() {
  const f = S.taskFilter;
  return t => (!f.prio || t.priority === f.prio) && (!f.cat || t.category === f.cat) && (!f.tag || (t.tags || []).includes(f.tag));
}
VIEWS.tasks = () => {
  const td = T(); const we = L.addDays(L.weekStart(td), 6);
  const ts = live('tasks').filter(taskFilterFn()); const open = ts.filter(isOpen);
  const views = {
    today: open.filter(t => L.isDate(t.due) && t.due <= td),
    week: open.filter(t => L.isDate(t.due) && t.due <= we),
    upcoming: open.filter(t => L.isDate(t.due) && t.due > td),
    overdue: open.filter(t => L.isDate(t.due) && t.due < td),
    anytime: open.filter(t => !L.isDate(t.due))
  };
  const inbox = all('inbox').filter(i => !i.archived);
  const sub = S.sub.tasks;
  let head = tabsHtml('tasks', [['today', 'Today', views.today.length], ['week', 'This week', views.week.length], ['upcoming', 'Upcoming'], ['overdue', 'Overdue', views.overdue.length], ['anytime', 'No date', views.anytime.length], ['inbox', 'Inbox', inbox.length], ['completed', 'Completed'], ['projects', 'Projects'], ['archived', 'Archived']]);
  if (sub === 'projects') return head + projectsView();
  if (sub === 'project') return head + projectDetail();
  if (sub === 'inbox') return head + inboxView(inbox);
  if (sub === 'archived') return head + archivedView(['tasks', 'projects']);
  const addBar = `<form class="inline-add" data-form="inline-task"><input type="text" id="inline-task" placeholder="Add a task (try: Call bank tmrw 4pm #work)" aria-label="New task" autocomplete="off"><button class="btn primary" type="submit">Add</button></form><div id="inline-task-preview" class="small muted" style="margin:-6px 0 10px;min-height:18px"></div>`;
  const cats = [...new Set(all('tasks').map(t => t.category).filter(Boolean))].sort();
  const tags = [...new Set(all('tasks').flatMap(t => t.tags || []))].sort();
  const filt = `<div class="hstack" style="margin-bottom:10px"><select id="f-prio" data-act-change="task-filter" data-k="prio" aria-label="Priority filter" style="width:auto">${opts([['high', 'High'], ['med', 'Medium'], ['low', 'Low']], S.taskFilter.prio, 'Any priority')}</select>
    <select id="f-cat" data-act-change="task-filter" data-k="cat" aria-label="Category filter" style="width:auto">${opts(cats, S.taskFilter.cat, 'Any category')}</select>
    ${tags.length ? `<select id="f-tag" data-act-change="task-filter" data-k="tag" aria-label="Tag filter" style="width:auto">${opts(tags.map(t => [t, '#' + t]), S.taskFilter.tag, 'Any tag')}</select>` : ''}
    <button class="btn sm ghost" data-act="new" data-c="tasks" style="margin-left:auto">Full task form</button></div>`;
  let list = [];
  if (sub === 'completed') {
    const done = ts.filter(t => t.status === 'done').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))).slice(0, 150);
    if (!done.length) return head + filt + emptyState('No completed tasks yet.');
    let last = ''; let html = '';
    done.forEach(t => { const d = L.istDateOf(t.completedAt); if (d !== last) { html += `<div class="small muted" style="font-weight:700;margin-top:12px">${esc(L.relDay(d))}</div>`; last = d; } html += taskRow(t, { done: true }); });
    return head + filt + `<div class="card"><div class="card-b list" style="padding-top:8px">${html}</div></div>`;
  }
  list = (views[sub] || views.today).slice();
  const rank = { high: 0, med: 1, low: 2 };
  list.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.dueTime || '99').localeCompare(String(b.dueTime || '99')) || (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3));
  const emptyMsg = { today: 'Nothing due today. Enjoy the space, or pull something forward.', week: 'Nothing else due this week.', upcoming: 'No upcoming dated tasks.', overdue: 'No overdue tasks.', anytime: 'No undated tasks.' }[sub];
  let body;
  if (!list.length) body = emptyState(emptyMsg);
  else if (sub === 'upcoming' || sub === 'week') {
    let last = ''; body = '';
    list.forEach(t => { if (t.due !== last) { body += `<div class="small muted" style="font-weight:700;margin-top:12px">${esc(L.relDay(t.due))}</div>`; last = t.due; } body += taskRow(t); });
  } else body = list.map(t => taskRow(t)).join('');
  return head + addBar + filt + `<div class="card"><div class="card-b list" style="padding-top:8px">${body}</div></div>`;
};
function projectsView() {
  const ps = live('projects');
  const add = `<div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="projects">New project</button></div>`;
  if (!ps.length) return add + emptyState('No projects yet. Projects group tasks with milestones, meeting notes and a deadline.');
  const groups = [['active', 'Active'], ['onhold', 'On hold'], ['done', 'Completed']];
  return add + groups.map(([k, l]) => {
    const g = ps.filter(p => (p.status || 'active') === k); if (!g.length) return '';
    return `<div class="sec-h"><h2>${l}</h2></div><div class="grid">${g.map(p => {
      const tasks = all('tasks').filter(t => t.projectId === p.id && !t.archived && t.status !== 'cancelled');
      const done = tasks.filter(t => t.status === 'done').length;
      const next = tasks.filter(isOpen).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')))[0];
      return `<button class="card scope-edge ${scopeOf(p)}" style="text-align:left;padding:14px;display:flex;flex-direction:column;gap:6px" data-act="open-project" data-id="${esc(p.id)}">
        <span class="row-title" style="font-size:16px">${esc(p.name)}</span>
        <span class="row-sub">${scopePill(p) || dotFor(p)}${p.deadline ? `<span class="${p.deadline < T() && k !== 'done' ? 'pill over' : ''}">Deadline ${esc(L.fmtDate(p.deadline))}</span>` : ''}<span>${done}/${tasks.length} tasks</span></span>
        ${tasks.length ? bar(done / tasks.length, scopeOf(p)) : ''}
        <span class="small muted">${next ? 'Next: ' + esc(next.title) : 'No open tasks'}</span></button>`;
    }).join('')}</div>`;
  }).join('');
}
function projectDetail() {
  const p = get('projects', S.projectId);
  if (!p) return emptyState('Project not found.', ['sub', 'Back to projects', 'data-k="tasks" data-v="projects"']);
  const tasks = all('tasks').filter(t => t.projectId === p.id && !t.archived);
  const open = tasks.filter(isOpen).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')));
  const done = tasks.filter(t => t.status === 'done').sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const ms = (p.milestones || []).slice().sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')));
  const notes = (p.notes || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<div class="hstack" style="margin-bottom:12px"><button class="btn sm ghost" data-act="sub" data-k="tasks" data-v="projects">${ICON.left} Projects</button><button class="btn sm" data-act="edit" data-c="projects" data-id="${esc(p.id)}" style="margin-left:auto">Edit project</button></div>
  <div class="card scope-edge ${scopeOf(p)}" style="padding:16px;margin-bottom:16px"><h2 style="font-family:var(--f-display);font-size:22px;font-weight:600">${esc(p.name)}</h2>
    <div class="row-sub" style="margin-top:6px"><span class="pill ${scopeOf(p)}">${scopeOf(p) === 'work' ? 'Work' : 'Personal'}</span><span>${esc({ active: 'Active', onhold: 'On hold', done: 'Completed' }[p.status || 'active'])}</span>${p.deadline ? `<span>Deadline ${esc(L.fmtDate(p.deadline))}</span>` : ''}</div>
    ${p.description ? `<p class="muted" style="margin:10px 0 0;max-width:65ch">${esc(p.description)}</p>` : ''}</div>
  <div class="grid">
    <section class="card"><div class="card-h"><h2>Next actions</h2><span class="badge">${open.length}</span></div><div class="card-b">
      <form class="inline-add" data-form="project-task" data-id="${esc(p.id)}"><input type="text" id="proj-task" placeholder="Add a task to this project" aria-label="New project task" autocomplete="off"><button class="btn sm primary" type="submit">Add</button></form>
      <div class="list">${open.map(t => taskRow(t)).join('') || emptyState('No open tasks.')}</div></div></section>
    <section class="card"><div class="card-h"><h2>Milestones</h2><div class="more"><button class="btn sm ghost" data-act="edit" data-c="projects" data-id="${esc(p.id)}">Edit</button></div></div><div class="card-b list">
      ${ms.map(m => `<div class="row ${m.done ? 'done' : ''}"><button class="chk sq" role="checkbox" aria-checked="${!!m.done}" data-act="toggle-ms" data-id="${esc(p.id)}" data-m="${esc(m.id)}" aria-label="Milestone ${esc(m.title)}">${ICON.tick}</button><span class="row-main"><span class="row-title">${esc(m.title)}</span><span class="row-sub">${m.due ? (m.due < T() && !m.done ? `<span class="pill over">${esc(L.fmtDate(m.due))}</span>` : esc(L.fmtDate(m.due))) : 'No date'}</span></span></div>`).join('') || emptyState('No milestones yet.')}</div></section>
    <section class="card wide"><div class="card-h"><h2>Meeting notes</h2><div class="more"><button class="btn sm" data-act="add-note" data-id="${esc(p.id)}">Add note</button></div></div><div class="card-b">
      ${notes.map(n => `<details style="border-top:1px solid var(--line);padding:8px 0"><summary style="cursor:pointer;font-weight:600;min-height:28px">${esc(n.title || 'Meeting')} <span class="small muted">· ${esc(L.fmtDate(n.date))}</span></summary><div style="white-space:pre-wrap;max-width:70ch;margin-top:6px">${esc(n.body)}</div><div class="hstack" style="margin-top:6px"><button class="btn sm ghost" data-act="edit-note" data-id="${esc(p.id)}" data-n="${esc(n.id)}">Edit note</button></div></details>`).join('') || emptyState('No meeting notes yet.')}</div></section>
    ${done.length ? `<section class="card wide"><div class="card-h"><h2>Completed</h2><span class="badge">${done.length}</span></div><div class="card-b list">${done.slice(0, 20).map(t => taskRow(t, { done: true })).join('')}</div></section>` : ''}
  </div>`;
}
function inboxView(items) {
  const add = `<form class="inline-add" data-form="inline-inbox"><input type="text" id="inline-inbox" placeholder="Capture anything — sort it later" aria-label="Capture to inbox" autocomplete="off"><button class="btn primary" type="submit">Capture</button></form>`;
  if (!items.length) return add + emptyState('Inbox is clear. Captured notes wait here until you turn them into tasks, groceries, expenses, events or documents.');
  return add + `<div class="card"><div class="card-b list" style="padding-top:8px">${items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(i => `<div class="row" style="flex-wrap:wrap"><span class="row-main" style="min-width:60%"><span class="row-title">${esc(i.text)}</span><span class="row-sub">Captured ${esc(L.fmtStamp(i.createdAt))}</span></span>
    <span class="hstack">${[['tasks', 'Task'], ['groceries', 'Grocery'], ['expenses', 'Expense'], ['events', 'Event'], ['docs', 'Document']].map(([c, l]) => `<button class="btn sm" data-act="organise" data-c="${c}" data-id="${esc(i.id)}">${l}</button>`).join('')}<button class="btn sm ghost" data-act="inbox-del" data-id="${esc(i.id)}">Discard</button></span></div>`).join('')}</div></div>`;
}
function archivedView(colls) {
  const rows = colls.flatMap(c => all(c).filter(r => r.archived && inScope(r)).map(r => ({ c, r })));
  if (!rows.length) return emptyState('Nothing archived here.');
  return `<div class="card"><div class="card-b list" style="padding-top:8px">${rows.map(({ c, r }) => `<div class="row" style="flex-wrap:wrap"><span class="row-main" style="min-width:50%"><span class="row-title">${esc(r.title || r.name || r.text || r.notes || '(untitled)')}</span><span class="row-sub">${esc(COLL_LABEL[c])} · archived ${esc(L.fmtStamp(r.updatedAt))}</span></span>
    <span class="hstack"><button class="btn sm" data-act="restore" data-c="${c}" data-id="${esc(r.id)}">Restore</button><button class="btn sm danger" data-act="purge" data-c="${c}" data-id="${esc(r.id)}">Delete permanently</button></span></div>`).join('')}</div></div>`;
}

/* ---------- Calendar & Reminders ---------- */
VIEWS.calendar = () => {
  const sub = S.sub.calendar;
  const head = tabsHtml('calendar', [['agenda', 'Agenda'], ['month', 'Month'], ['reminders', 'Reminders']]) +
    `<div class="hstack" style="margin-bottom:12px"><button class="btn sm primary" data-act="new" data-c="events">Add appointment or date</button><span class="small muted">Task deadlines appear here as “Due” and never become appointments.</span></div>`;
  if (sub === 'reminders') return head + remindersView();
  if (sub === 'month') return head + monthView();
  const td = T(); const items = agendaItems(td, L.addDays(td, 30)).filter(i => !i.done);
  const over = live('tasks').filter(t => isOpen(t) && L.isDate(t.due) && t.due < td);
  let html = over.length ? `<div class="note err" style="margin-bottom:12px"><span>${over.length} overdue task${over.length > 1 ? 's' : ''}</span><button class="btn sm" data-act="go" data-v="tasks:overdue">Review</button></div>` : '';
  if (!items.length) return head + html + emptyState('Nothing in the next 30 days.');
  let last = ''; html += '<div class="card"><div class="card-b list">';
  items.forEach(i => { if (i.date !== last) { html += `<div class="small" style="font-weight:700;margin-top:12px;${i.date === td ? 'color:var(--ink)' : 'color:var(--muted)'}">${esc(L.relDay(i.date))}${i.date !== td && L.relDay(i.date).indexOf(',') < 0 && L.relDay(i.date).length < 10 ? ' · ' + esc(L.fmtDate(i.date)) : ''}</div>`; last = i.date; } html += agendaRow(i); });
  return head + html + '</div></div>';
};
function monthView() {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = `${S.calMonth}-01`; const start = L.weekStart(first); const end = L.addDays(L.weekStart(L.monthEnd(first)), 6);
  const items = agendaItems(start, end); const by = {};
  items.forEach(i => (by[i.date] = by[i.date] || []).push(i));
  const td = T();
  let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dh">${d}</div>`).join('');
  L.rangeDates(start, end).forEach(d => {
    const its = by[d] || [];
    cells += `<button class="day ${d.slice(0, 7) !== S.calMonth ? 'out' : ''} ${d === td ? 'today' : ''} ${d === S.calSel ? 'sel' : ''}" data-act="cal-sel" data-v="${d}" aria-label="${esc(L.fmtDate(d))}, ${its.length} item${its.length === 1 ? '' : 's'}">
      <span class="dn">${+d.slice(8)}</span>${its.slice(0, 3).map(i => `<span class="ev ${scopeOf(i.r)} ${i.kind === 'deadline' ? 'deadline' : ''}">${esc((i.time ? L.fmtTime(i.time).replace(':00', '') + ' ' : '') + i.title)}</span>`).join('')}${its.length > 3 ? `<span class="small faint">+${its.length - 3}</span>` : ''}
      <span class="dots">${its.slice(0, 4).map(i => `<i class="${scopeOf(i.r)}"></i>`).join('')}</span></button>`;
  });
  const sel = by[S.calSel] || agendaItems(S.calSel, S.calSel);
  return `<div class="hstack" style="margin-bottom:10px"><button class="icon-btn" data-act="cal-month" data-v="-1" aria-label="Previous month">${ICON.left}</button><h2 style="font-family:var(--f-display);font-size:19px;font-weight:600;min-width:150px;text-align:center">${L.MONTHS[m - 1]} ${y}</h2><button class="icon-btn" data-act="cal-month" data-v="1" aria-label="Next month">${ICON.right}</button><button class="btn sm ghost" data-act="cal-month" data-v="0">Today</button></div>
  <div class="cal">${cells}</div>
  <div class="sec-h"><h2>${esc(L.relDay(S.calSel))}${L.relDay(S.calSel).length < 10 ? ' · ' + esc(L.fmtDate(S.calSel)) : ''}</h2><div class="tools"><button class="btn sm" data-act="new" data-c="events" data-date="${S.calSel}">Add on this day</button></div></div>
  <div class="card"><div class="card-b list">${sel.length ? sel.map(agendaRow).join('') : emptyState('Nothing on this day.')}</div></div>`;
}
function remindersView() {
  const rows = [...live('tasks').filter(t => t.reminder && t.reminder.at && isOpen(t)).map(r => ({ c: 'tasks', r, title: r.title })),
    ...live('events').filter(e => e.reminder && e.reminder.at).map(r => ({ c: 'events', r, title: r.title })),
    ...live('habits').filter(h => h.reminder && h.reminder.at).map(r => ({ c: 'habits', r, title: r.title })),
    ...live('bills').filter(b => b.reminder && b.reminder.at).map(r => ({ c: 'bills', r, title: r.name }))]
    .sort((a, b) => a.r.reminder.at.localeCompare(b.r.reminder.at));
  const st = feedState();
  return feedCard(true) + `<div class="sec-h"><h2>Reminders</h2><span class="pill ${st === 'not_configured' ? '' : st}">${REM_STATUS[st]}</span></div>
    <div class="card"><div class="card-b list">${rows.length ? rows.map(({ c, r, title }) => { const rm = r.reminder;
      return `<div class="row"><button class="row-main" data-act="edit" data-c="${c}" data-id="${esc(r.id)}"><span class="row-title">${dotFor(r)}${esc(title)}</span>
        <span class="row-sub"><span>${esc(L.fmtDate(rm.at.slice(0, 10)))} ${esc(L.fmtTime(rm.at.slice(11, 16)))}</span>${rm.repeat && rm.repeat !== 'none' && c !== 'tasks' ? `<span>↻ ${esc(rm.repeat)}</span>` : ''}${remPill(rm)}</span></button></div>`; }).join('') : emptyState('No reminders yet. Add one from any task, event, habit or bill.')}</div></div>
    <div class="def">Bills alert at 9:00 am on the due day and documents 7 days before expiry or renewal, even without a reminder set. Task and event alerts use the reminder time you set.</div>`;
}
function feedCard(full) {
  const f = S.settings.feed || {}; const st = feedState();
  const url = f.token && !S.preview ? Cloud.feedUrl(f.token) : '';
  const web = url.replace(/^https:/, 'webcal:');
  const steps = `<ol class="steps"><li><b>iPhone:</b> Settings → Calendar → Accounts → Add Account → Other → <i>Add Subscribed Calendar</i>. Paste the link, tap Next, then Save. In Accounts → Fetch New Data, set it to fetch every 15 minutes.</li>
    <li><b>Outlook (Windows):</b> Calendar → Add calendar → Subscribe from web, paste the link. Outlook refreshes subscribed calendars every few hours, so use it for an overview and rely on the iPhone for alerts.</li></ol>`;
  return `<section class="card feed ${full ? '' : 'wide'}"><div class="card-h"><span class="chip-ic" style="--c:var(--c-calendar)">${ICON.bell}</span><h2>Real reminders via your calendar</h2><span class="pill ${st === 'not_configured' ? '' : st}" style="margin-left:auto">${REM_STATUS[st]}</span></div><div class="card-b stack">
    <p class="small muted" style="margin:0">The planner can't push notifications by itself. Instead it publishes a private calendar link. Your iPhone Calendar subscribes to it and fires the alerts, even when Daybook is closed. Changes reach your phone the next time the calendar refreshes (every 15 minutes at best).</p>
    ${S.preview ? '<div class="note warn small">Not available in preview.</div>' : !f.token ? `<div><button class="btn primary" data-act="feed-create">Create my calendar link</button></div>` : `
      <div class="field"><span>Your private calendar link</span><pre class="copy" id="feed-url">${esc(web)}</pre><div class="hstack"><button class="btn sm" data-act="copy" data-target="feed-url">Copy link</button><button class="btn sm" data-act="feed-test">Test link</button>${f.lastTest ? `<span class="small ${f.lastTest.ok ? 'muted' : ''}" style="${f.lastTest.ok ? '' : 'color:var(--danger)'}">${f.lastTest.ok ? `Worked ${esc(L.fmtStamp(f.lastTest.at))} · ${f.lastTest.events} item${f.lastTest.events === 1 ? '' : 's'}` : esc(f.lastTest.msg)}</span>` : '<span class="small muted">Not tested yet</span>'}</div><small>Anyone with this link can see your calendar items. Keep it private; make a new one if it leaks.</small></div>
      ${steps}
      <div class="field"><span>Where have you subscribed?</span><div class="choice">${[['iphone', 'iPhone Calendar'], ['outlook', 'Outlook'], ['google', 'Google Calendar']].map(([k, l]) => `<button type="button" data-act="feed-sub" data-v="${k}" aria-pressed="${(f.subscribedOn || []).includes(k)}">${l}</button>`).join('')}</div><small>Reminders show “Scheduled” only after a successful test and once you've ticked where you subscribed.</small></div>
      <div class="hstack"><button class="btn sm ghost" data-act="feed-toggle">${f.enabled === false ? 'Resume feed' : 'Pause feed'}</button><button class="btn sm ghost danger" data-act="feed-rotate">Make a new link</button></div>`}
  </div></section>`;
}
/* ---------- Goals & Habits ---------- */
VIEWS.goals = () => {
  const sub = S.sub.goals;
  const head = tabsHtml('goals', [['habits', 'Habits'], ['goals', 'Goals'], ['archived', 'Archived']]);
  if (sub === 'archived') return head + archivedView(['goals', 'habits']);
  if (sub === 'goals') {
    const gs = live('goals');
    const add = `<div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="goals">New goal</button></div>`;
    if (!gs.length) return head + add + emptyState('No goals yet. A goal can have a measurable target (for example 12 books, ₹50,000 saved) or milestones.');
    return head + add + `<div class="grid">${gs.sort((a, b) => (a.status === 'done') - (b.status === 'done') || String(a.targetDate || '9').localeCompare(String(b.targetDate || '9'))).map(g => {
      const p = L.goalProgress(g); const ms = g.milestones || [];
      return `<section class="card scope-edge ${scopeOf(g)}"><div class="card-h"><button class="link" style="font-size:16px;text-decoration:none" data-act="edit" data-c="goals" data-id="${esc(g.id)}">${esc(g.title)}</button>${g.status === 'done' ? '<span class="pill ok">Achieved</span>' : ''}</div><div class="card-b stack" style="gap:8px">
        <div class="row-sub">${scopePill(g) || dotFor(g)}${g.category ? `<span>${esc(g.category)}</span>` : ''}${g.targetDate ? `<span>Target ${esc(L.fmtDate(g.targetDate))}</span>` : ''}</div>
        ${p ? `<div>${bar(p.pct, scopeOf(g))}<div class="small muted" style="margin-top:4px">${esc(p.label)} · ${pct(p.pct)}</div></div>` : '<div class="small muted">No measurable target or milestones yet.</div>'}
        ${g.metric && g.metric.target !== '' && g.metric.target != null ? `<form class="hstack" data-form="goal-log" data-id="${esc(g.id)}"><input type="number" step="any" id="gl-${esc(g.id)}" name="v" placeholder="New value" aria-label="Update current value for ${esc(g.title)}" style="width:130px"><button class="btn sm" type="submit">Update</button></form>` : ''}
        ${ms.length ? `<div class="list">${ms.map(m => `<div class="row ${m.done ? 'done' : ''}" style="min-height:36px"><button class="chk sq" role="checkbox" aria-checked="${!!m.done}" data-act="toggle-gms" data-id="${esc(g.id)}" data-m="${esc(m.id)}" aria-label="Milestone ${esc(m.title)}">${ICON.tick}</button><span class="row-title small">${esc(m.title)}${m.due ? ` <span class="faint">· ${esc(L.fmtShort(m.due))}</span>` : ''}</span></div>`).join('')}</div>` : ''}
        ${g.nextAction ? `<div class="small"><b>Next action:</b> ${esc(g.nextAction)}</div>` : ''}</div></section>`;
    }).join('')}</div>`;
  }
  const hs = live('habits'); const td = T();
  const add = `<div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="habits">New habit</button><span class="small muted">One tap marks done; tap again for skipped, again to clear.</span></div>`;
  if (!hs.length) return head + add + emptyState('No habits yet.');
  const from = L.addDays(td, -13);
  return head + add + `<div class="grid">${hs.map(h => {
    const s30 = L.habitStats(h, L.addDays(td, -29), td);
    const cells = L.rangeDates(from, td).map(d => { const sch = L.habitScheduled(h, d); const v = (h.log || {})[d]; const cls = !sch ? 'off' : v === 'done' ? 'done' : v === 'skip' ? 'skip' : 'nr';
      return `<i class="${cls}" title="${esc(L.fmtDate(d))}: ${!sch ? 'not scheduled' : v === 'done' ? 'completed' : v === 'skip' ? 'skipped' : 'not recorded'}"></i>`; }).join('');
    return `<section class="card"><div class="card-b" style="padding-top:8px">${habitTodayRow(h)}
      <div class="heat" role="img" aria-label="Last 14 days for ${esc(h.title)}">${cells}</div>
      <div class="small muted" style="margin-top:8px">Last 30 days: ${s30.done} done · ${s30.skip} skipped · ${s30.notRec} not recorded of ${s30.scheduled} scheduled${s30.pending ? ' (today open)' : ''}${s30.streak ? ` · streak ${s30.streak}` : ''}</div>
      <details style="margin-top:6px"><summary class="small" style="cursor:pointer;min-height:28px">Record an earlier day</summary><div class="hstack" style="margin-top:6px">${L.rangeDates(L.addDays(td, -6), L.addDays(td, -1)).filter(d => L.habitScheduled(h, d)).map(d => { const v = (h.log || {})[d] || ''; return `<button class="habit-tap" style="min-width:0;padding:0 10px" data-act="habit-tap" data-id="${esc(h.id)}" data-d="${d}" data-v="${v}" aria-label="${esc(L.fmtDate(d))}: ${v || 'not recorded'}">${L.WD[L.dow(d)]} ${+d.slice(8)}${v === 'done' ? ' ✓' : v === 'skip' ? ' –' : ''}</button>`; }).join('')}</div></details>
    </div></section>`;
  }).join('')}</div><div class="legend"><span><i style="background:var(--ok)"></i>Completed</span><span><i style="background:var(--warn)"></i>Skipped</span><span><i style="background:var(--sunk);outline:1px solid var(--line)"></i>Not recorded</span><span><i style="border:1px dashed var(--line)"></i>Not scheduled</span></div>`;
};

/* ---------- Home & Groceries ---------- */
function groceryRow(g, compact) {
  const got = g.status === 'bought';
  return `<div class="row ${got ? 'done' : ''}"><button class="chk sq" role="checkbox" aria-checked="${got}" data-act="toggle-grocery" data-id="${esc(g.id)}" aria-label="${got ? 'Mark needed' : 'Mark bought'}: ${esc(g.name)}">${ICON.tick}</button>
    <button class="row-main" data-act="edit" data-c="groceries" data-id="${esc(g.id)}"><span class="row-title">${esc(g.name)}${g.qty ? ` <span class="muted num">${esc(g.qty)}${g.unit ? ' ' + esc(g.unit) : ''}</span>` : ''}</span>
    ${compact ? '' : `<span class="row-sub">${g.restock ? '<span class="pill soon">Restock</span>' : ''}${g.store ? `<span>${esc(g.store)}</span>` : ''}${g.actual ? `<span>${L.money(g.actual)}</span>` : g.price ? `<span>est. ${L.money(g.price)}</span>` : ''}</span>`}</button></div>`;
}
function commonGroceries() {
  const need = new Set(live('groceries').filter(g => g.status !== 'bought').map(g => g.name.toLowerCase()));
  const freq = new Map();
  all('purchases').forEach(p => (p.items || []).forEach(i => { const k = i.name; freq.set(k, (freq.get(k) || 0) + 1); }));
  all('groceries').forEach(g => freq.set(g.name, (freq.get(g.name) || 0) + 0.5));
  return [...freq.entries()].filter(([n]) => !need.has(n.toLowerCase())).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n]) => n);
}
VIEWS.home = () => {
  const sub = S.sub.home;
  const head = tabsHtml('home', [['groceries', 'Groceries', live('groceries').filter(g => g.status !== 'bought').length], ['pantry', 'Pantry'], ['meals', 'Meal plan'], ['household', 'Household'], ['trips', 'Purchase history']]);
  if (sub === 'pantry') return head + pantryView();
  if (sub === 'meals') return head + mealsView();
  if (sub === 'household') return head + householdView();
  if (sub === 'trips') return head + tripsView();
  const gs = live('groceries');
  const need = gs.filter(g => g.status !== 'bought'), got = gs.filter(g => g.status === 'bought');
  const common = commonGroceries();
  const sugg = pantrySuggestions();
  const by = S.groupGroceriesBy;
  const groups = {}; need.forEach(g => { const k = (by === 'store' ? g.store : g.category) || (by === 'store' ? 'Any store' : 'Other'); (groups[k] = groups[k] || []).push(g); });
  const order = by === 'store' ? Object.keys(groups).sort() : [...GROC_CATS, ...Object.keys(groups).filter(k => !GROC_CATS.includes(k))].filter(k => groups[k]);
  return head + `<form class="inline-add" data-form="inline-grocery"><input type="text" id="inline-grocery" placeholder="Add item — e.g. 2 kg rice" aria-label="New grocery item" autocomplete="off"><button class="btn primary" type="submit">Add</button></form>
    <div id="inline-grocery-preview" class="small muted" style="margin:-6px 0 10px;min-height:18px"></div>
    ${common.length ? `<div class="small muted" style="font-weight:700;margin-bottom:6px">Add again</div><div class="choice" style="margin-bottom:14px">${common.map(n => `<button type="button" data-act="regrocery" data-v="${esc(n)}">+ ${esc(n)}</button>`).join('')}</div>` : ''}
    ${sugg.length ? `<div class="note warn" style="margin-bottom:14px"><span>Pantry is low on ${sugg.map(p => esc(p.name)).join(', ')}.</span><button class="btn sm" data-act="add-pantry-sugg">Add to list</button></div>` : ''}
    <div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="shop" ${need.length ? '' : 'disabled'}>Shopping mode</button><button class="btn sm" data-act="finish-trip" ${got.length ? '' : 'disabled'}>Finish trip (${got.length} bought)</button>
      <label class="small muted hstack" style="margin-left:auto">Group by <select id="g-group" data-act-change="group-groc" style="width:auto">${opts([['category', 'Category'], ['store', 'Store']], by)}</select></label></div>
    ${need.length ? order.map(k => `<div class="sec-h" style="margin:14px 0 4px"><h2>${esc(k)}</h2><span class="badge">${groups[k].length}</span></div><div class="card"><div class="card-b list" style="padding-top:4px">${groups[k].map(g => groceryRow(g)).join('')}</div></div>`).join('') : emptyState('Nothing needed. Add items above or tap a common item.')}
    ${got.length ? `<div class="sec-h"><h2>In the basket</h2><span class="badge">${got.length}</span><div class="tools"><span class="small muted">Finish the trip to save it to purchase history.</span></div></div><div class="card"><div class="card-b list">${got.map(g => groceryRow(g)).join('')}</div></div>` : ''}`;
};
function pantrySuggestions() {
  const need = new Set(live('groceries').filter(g => g.status !== 'bought').map(g => g.name.toLowerCase()));
  return live('pantry').filter(p => p.qty !== '' && p.qty != null && p.min !== '' && p.min != null && isFinite(+p.qty) && isFinite(+p.min) && +p.qty <= +p.min && !need.has(String(p.name).toLowerCase()));
}
function pantryView() {
  const ps = live('pantry').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `<div class="note" style="margin-bottom:12px"><span class="small">Optional. Set a quantity and a “restock at” level for an item to get shopping suggestions. Items without both numbers are never suggested.</span></div>
    <div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="pantry">Add pantry item</button></div>
    <div class="card"><div class="card-b list">${ps.length ? ps.map(p => { const low = pantrySuggestions().some(x => x.id === p.id) || (p.qty !== '' && p.min !== '' && p.qty != null && p.min != null && +p.qty <= +p.min);
      return `<div class="row"><button class="row-main" data-act="edit" data-c="pantry" data-id="${esc(p.id)}"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${p.qty != null && p.qty !== '' ? `<span class="num">${esc(p.qty)} ${esc(p.unit || '')}</span>` : '<span>Quantity not tracked</span>'}${p.min != null && p.min !== '' ? `<span>restock at ${esc(p.min)}</span>` : ''}${low ? '<span class="pill soon">Low</span>' : ''}<span>updated ${esc(L.fmtDate(L.istDateOf(p.updatedAt)))}</span></span></button>
      ${p.qty != null && p.qty !== '' ? `<button class="icon-btn" data-act="pantry-step" data-id="${esc(p.id)}" data-v="-1" aria-label="Decrease ${esc(p.name)}">${ICON.minus}</button><button class="icon-btn" data-act="pantry-step" data-id="${esc(p.id)}" data-v="1" aria-label="Increase ${esc(p.name)}">${ICON.plus}</button>` : ''}</div>`; }).join('') : emptyState('Pantry is empty.')}</div></div>`;
}
function mealsView() {
  const ws = S.mealWeek; const id = 'w-' + ws; const doc = get('meals', id) || { days: {} };
  const slots = [['b', 'Breakfast'], ['l', 'Lunch'], ['d', 'Dinner']];
  return `<div class="hstack" style="margin-bottom:12px"><button class="icon-btn" data-act="meal-week" data-v="-7" aria-label="Previous week">${ICON.left}</button><b>Week of ${esc(L.fmtDate(ws))}</b><button class="icon-btn" data-act="meal-week" data-v="7" aria-label="Next week">${ICON.right}</button><span class="small muted">Saves when you leave a field.</span></div>
  <div class="grid">${L.rangeDates(ws, L.addDays(ws, 6)).map(d => `<section class="card"><div class="card-h"><h2>${L.WD[L.dow(d)]} · ${esc(L.fmtShort(d))}</h2></div><div class="card-b stack" style="gap:8px">${slots.map(([k, l]) => `<label class="field"><span>${l}</span><input type="text" id="meal-${d}-${k}" data-meal="${d}" data-slot="${k}" value="${esc(((doc.days || {})[d] || {})[k] || '')}" autocomplete="off"></label>`).join('')}</div></section>`).join('')}</div>`;
}
function householdView() {
  const td = T();
  const hts = live('tasks').filter(t => isOpen(t) && ['Home', 'Family'].includes(t.category)).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9')));
  const dates = agendaItems(td, L.addDays(td, 365)).filter(i => (i.c === 'events' && i.kind === 'date') || i.kind === 'renewal' || i.kind === 'expiry').filter(i => scopeOf(i.r) === 'personal').slice(0, 15);
  return `<div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="tasks" data-cat="Home">Add household task</button><button class="btn sm" data-act="new" data-c="events" data-kind="date">Add important date</button></div>
  <div class="grid"><section class="card"><div class="card-h"><h2>Household &amp; maintenance</h2><span class="badge">${hts.length}</span></div><div class="card-b list">${hts.map(t => taskRow(t)).join('') || emptyState('No open household tasks. Tasks in the Home or Family category appear here.')}</div></section>
  <section class="card"><div class="card-h"><h2>Important dates &amp; renewals</h2></div><div class="card-b list">${dates.map(i => `<div class="row"><span class="kind">${esc(KIND_LABEL[i.kind])}</span><button class="row-main" data-act="edit" data-c="${i.c}" data-id="${esc(i.r.id)}"><span class="row-title">${esc(i.title)}</span><span class="row-sub">${esc(L.relDay(i.date))}</span></button></div>`).join('') || emptyState('No personal dates or renewals in the next year.')}</div></section></div>`;
}
function tripsView() {
  const ps = live('purchases').sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!ps.length) return emptyState('No finished shopping trips yet. Tick items as bought, then tap “Finish trip”.');
  return `<div class="card"><div class="card-b list">${ps.map(p => { const priced = (p.items || []).filter(i => i.price); return `<details class="row" style="display:block;padding:8px 0"><summary style="cursor:pointer;display:flex;gap:10px;align-items:center;min-height:32px"><b>${esc(L.fmtDate(p.date))}</b><span class="small muted">${(p.items || []).length} items${p.store ? ' · ' + esc(p.store) : ''}</span><span class="num" style="margin-left:auto">${priced.length ? L.money(p.total) + (priced.length < (p.items || []).length ? ' (partly priced)' : '') : 'No prices'}</span></summary>
    <table class="tbl" style="margin-top:6px"><tbody>${(p.items || []).map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.qty || '')} ${esc(i.unit || '')}</td><td class="r">${i.price ? L.money(i.price) : '—'}</td></tr>`).join('')}</tbody></table>
    <div class="hstack" style="margin-top:8px"><button class="btn sm" data-act="reuse-trip" data-id="${esc(p.id)}">Add these to the list again</button>${p.expenseId ? '<span class="small muted">Recorded as an expense</span>' : ''}<button class="btn sm ghost" data-act="archive" data-c="purchases" data-id="${esc(p.id)}">Archive</button></div></details>`; }).join('')}</div></div>`;
}
function renderShopping() {
  let el = document.getElementById('shop-overlay');
  if (!S.shopping) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'shop-overlay'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Shopping mode'); el.style.cssText = 'position:fixed;inset:0;z-index:55;background:var(--bg);overflow-y:auto;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px calc(env(safe-area-inset-bottom,0px) + 24px)'; document.body.appendChild(el); }
  const gs = live('groceries'); const need = gs.filter(g => g.status !== 'bought'), got = gs.filter(g => g.status === 'bought');
  const order = [...GROC_CATS];
  need.sort((a, b) => order.indexOf(a.category || 'Other') - order.indexOf(b.category || 'Other') || a.name.localeCompare(b.name));
  const item = g => `<div class="shop-item ${g.status === 'bought' ? 'got' : ''}"><button class="chk" role="checkbox" aria-checked="${g.status === 'bought'}" data-act="toggle-grocery" data-id="${esc(g.id)}" aria-label="${esc(g.name)}">${ICON.tick}</button><span class="nm" style="flex:1">${esc(g.name)}</span><span class="muted num">${esc(g.qty || '')} ${esc(g.unit || '')}</span></div>`;
  el.innerHTML = `<div style="max-width:640px;margin:0 auto"><div class="hstack" style="margin-bottom:10px"><h2 style="font-family:var(--f-display);font-size:22px;font-weight:600;margin-right:auto">Shopping</h2><span class="muted">${got.length} of ${gs.length}</span><button class="btn" data-act="shop-done">Done</button></div>
    ${need.map(item).join('') || '<div class="empty" style="font-size:17px">Everything is in the basket.</div>'}
    ${got.length ? `<div class="small muted" style="font-weight:700;margin-top:18px">In the basket</div>${got.map(item).join('')}` : ''}
    <div class="hstack" style="margin-top:20px"><button class="btn primary" data-act="finish-trip" ${got.length ? '' : 'disabled'}>Finish trip</button></div></div>`;
}

/* ---------- Money ---------- */
function budgetsInScope() { return (S.settings.budgets || []).filter(b => S.scope === 'all' || (b.scope || 'personal') === S.scope); }
VIEWS.money = () => {
  const sub = S.sub.money;
  const head = tabsHtml('money', [['overview', 'Overview'], ['expenses', 'Expenses'], ['bills', 'Bills & subscriptions'], ['budgets', 'Budgets'], ['archived', 'Archived']]);
  if (sub === 'archived') return head + archivedView(['expenses', 'bills']);
  if (sub === 'bills') return head + billsView();
  if (sub === 'budgets') return head + budgetsView();
  if (sub === 'expenses') return head + expensesView();
  const td = T(); const mo = S.moneyMonth; const ms = mo + '-01'; const me = L.monthEnd(ms); const to = me < td ? me : td;
  const st = L.spendStats(live('expenses'), ms, to);
  const buds = budgetsInScope(); const budTotal = buds.reduce((s, b) => s + (+b.amount || 0), 0);
  const upcoming = []; live('bills').forEach(b => L.billProjection(b, td, L.addDays(td, 30)).forEach(d => upcoming.push({ b, d })));
  upcoming.sort((a, b) => a.d.localeCompare(b.d));
  const planned = upcoming.reduce((s, x) => s + (+x.b.amount || 0), 0);
  const catRows = [...new Set([...st.byCat.map(r => r.key), ...buds.map(b => b.category)])].map(k => {
    const spent = (st.byCat.find(r => r.key === k) || {}).value || 0; const bud = buds.filter(b => b.category === k).reduce((s, b) => s + (+b.amount || 0), 0); return { k, spent, bud };
  }).sort((a, b) => b.spent - a.spent);
  return head + monthNav() + `<div class="kpis" style="margin-bottom:16px"><div class="kpi"><b>${L.money(st.total)}</b><span>Actual spending${mo === td.slice(0, 7) ? ' to date' : ''} (${st.count} entries)</span></div><div class="kpi"><b>${budTotal ? L.money(budTotal) : '—'}</b><span>Monthly budget</span></div><div class="kpi"><b>${budTotal ? L.money(budTotal - st.total) : '—'}</b><span>${budTotal && st.total > budTotal ? 'Over budget' : 'Remaining'}</span></div><div class="kpi"><b>${L.money(planned)}</b><span>Planned bills, next 30 days</span></div></div>
    <div class="grid"><section class="card"><div class="card-h"><h2>By category</h2></div><div class="card-b">${catRows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Category</th><th class="r">Spent</th><th class="r">Budget</th><th style="width:30%"></th></tr></thead><tbody>${catRows.map(r => `<tr><td>${esc(r.k)}</td><td class="r">${L.money(r.spent)}</td><td class="r">${r.bud ? L.money(r.bud) : '—'}</td><td>${r.bud ? bar(r.spent / r.bud, r.spent > r.bud ? 'over' : '') : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No spending recorded this month.')}
      ${st.transfers ? `<div class="def">${st.transfers} transfer${st.transfers > 1 ? 's' : ''} excluded from spending totals.</div>` : ''}</div></section>
    <section class="card"><div class="card-h"><h2>Planned · next 30 days</h2><span class="badge">${upcoming.length}</span></div><div class="card-b list">${upcoming.length ? upcoming.slice(0, 12).map(x => `<div class="row"><button class="row-main" data-act="edit" data-c="bills" data-id="${esc(x.b.id)}"><span class="row-title">${esc(x.b.name)}</span><span class="row-sub">${dotFor(x.b)}<span class="${x.d < td ? 'pill over' : ''}">${esc(L.relDay(x.d))}</span>${x.b.subscription ? '<span>Subscription</span>' : ''}</span></button><span class="num">${L.money(x.b.amount)}</span></div>`).join('') : emptyState('No bills in the next 30 days.')}
      <div class="def">Planned costs are bills not yet paid. They count as spending only when marked paid.</div></div></section></div>
    <div class="hstack" style="margin-top:16px"><button class="btn primary sm" data-act="new" data-c="expenses">Record expense</button><button class="btn sm" data-act="new" data-c="bills">Add bill or subscription</button></div>`;
};
function monthNav() {
  const mo = S.moneyMonth; const [y, m] = mo.split('-').map(Number);
  return `<div class="hstack" style="margin-bottom:12px"><button class="icon-btn" data-act="money-month" data-v="-1" aria-label="Previous month">${ICON.left}</button><b style="min-width:110px;text-align:center">${L.MONTHS[m - 1]} ${y}</b><button class="icon-btn" data-act="money-month" data-v="1" aria-label="Next month">${ICON.right}</button>${mo !== T().slice(0, 7) ? '<button class="btn sm ghost" data-act="money-month" data-v="0">This month</button>' : ''}</div>`;
}
function expensesView() {
  const mo = S.moneyMonth; const ex = live('expenses').filter(e => String(e.date).slice(0, 7) === mo).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  let last = ''; let html = '';
  ex.forEach(e => { if (e.date !== last) { const dayTot = ex.filter(x => x.date === e.date && x.kind !== 'transfer').reduce((s, x) => s + (x.kind === 'refund' ? -1 : 1) * (+x.amount || 0), 0); html += `<div class="hstack small muted" style="font-weight:700;margin-top:12px"><span>${esc(L.relDay(e.date))}</span><span class="num" style="margin-left:auto">${L.money(dayTot)}</span></div>`; last = e.date; }
    const rc = e.docId ? get('docs', e.docId) : null;
    html += `<div class="row"><button class="row-main" data-act="edit" data-c="expenses" data-id="${esc(e.id)}"><span class="row-title">${esc(e.notes || e.category || 'Expense')}</span><span class="row-sub">${dotFor(e)}<span>${esc(e.category || 'Other')}</span>${e.kind === 'transfer' ? '<span class="pill">Transfer · not counted</span>' : e.kind === 'refund' ? '<span class="pill ok">Refund</span>' : ''}${e.billId ? '<span>Bill payment</span>' : ''}${e.tripId ? '<span>Grocery trip</span>' : ''}${rc ? `<span>Receipt: ${esc(rc.title)}</span>` : ''}${scopePill(e)}</span></button><span class="num" style="font-weight:600">${e.kind === 'refund' ? '−' : ''}${L.money(e.amount)}</span></div>`; });
  return monthNav() + `<form class="inline-add" data-form="inline-expense"><input type="text" id="inline-expense" placeholder="e.g. 250 lunch, 1200 uber yesterday #work" aria-label="New expense" autocomplete="off" inputmode="text"><button class="btn primary" type="submit">Add</button></form>
    <div id="inline-expense-preview" class="small muted" style="margin:-6px 0 10px;min-height:18px"></div>
    <div class="hstack" style="margin-bottom:10px"><button class="btn sm ghost" data-act="new" data-c="expenses">Full expense form</button></div>
    <div class="card"><div class="card-b list">${html || emptyState('No expenses this month.')}</div></div>`;
}
function billsView() {
  const bs = live('bills').sort((a, b) => String(a.nextDue || '9').localeCompare(String(b.nextDue || '9')));
  const monthly = bs.filter(b => b.nextDue).reduce((s, b) => s + ({ monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, weekly: 52 / 12 }[b.freq] || 0) * (+b.amount || 0), 0);
  return `<div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="bills">Add bill or subscription</button><span class="small muted">Recurring commitments ≈ ${L.money(monthly)} per month</span></div>
  <div class="card"><div class="card-b list">${bs.length ? bs.map(b => { const st = L.billState(b); return `<div class="row" style="flex-wrap:wrap"><button class="row-main" style="min-width:55%" data-act="edit" data-c="bills" data-id="${esc(b.id)}"><span class="row-title">${esc(b.name)} <span class="num muted">${L.money(b.amount)}</span></span>
    <span class="row-sub">${dotFor(b)}<span class="pill ${st.key === 'overdue' ? 'over' : st.key === 'due' ? 'soon' : st.key === 'done' ? 'ok' : ''}">${esc(st.label)}</span>${b.nextDue ? `<span>Next ${esc(L.fmtDate(b.nextDue))}</span>` : ''}<span>${esc(b.freq === 'once' ? 'One-time' : b.freq)}</span>${b.subscription ? '<span>Subscription</span>' : ''}${b.autopay ? '<span>Autopay</span>' : ''}${remPill(b.reminder)}${scopePill(b)}</span></button>
    ${b.nextDue ? `<button class="btn sm" data-act="bill-paid" data-id="${esc(b.id)}">Mark paid</button>` : ''}</div>`; }).join('') : emptyState('No bills or subscriptions yet.')}</div></div>
  <div class="def">“Mark paid” records one expense for that due date and moves the bill to its next date, so a payment is never counted twice.</div>`;
}
function budgetsView() {
  const bs = (S.settings.budgets || []);
  return `<div class="note" style="margin-bottom:12px"><span class="small">Monthly budgets by category. Personal and Work budgets are kept separate.</span></div>
  <form class="card" data-form="budget" style="padding:14px;margin-bottom:14px"><div class="f3"><label class="field"><span>Category</span><select name="category" id="bud-cat">${opts(EXP_CATS)}</select></label><label class="field"><span>Monthly amount (₹)</span><input type="number" name="amount" id="bud-amt" min="0" step="1" required inputmode="decimal"></label><label class="field"><span>Scope</span><select name="scope" id="bud-scope">${opts([['personal', 'Personal'], ['work', 'Work']], S.scope === 'work' ? 'work' : 'personal')}</select></label></div><div class="hstack" style="margin-top:10px"><button class="btn primary sm" type="submit">Save budget</button><span class="small muted">Saving a category again replaces its amount.</span></div></form>
  <div class="card"><div class="card-b list">${bs.length ? bs.map(b => `<div class="row"><span class="row-main"><span class="row-title">${esc(b.category)}</span><span class="row-sub"><span class="pill ${b.scope || 'personal'}">${b.scope === 'work' ? 'Work' : 'Personal'}</span></span></span><span class="num">${L.money(b.amount)}</span><button class="btn sm ghost" data-act="budget-del" data-id="${esc(b.id)}">Remove</button></div>`).join('') : emptyState('No budgets yet.')}</div></div>`;
}

/* ---------- Documents ---------- */
VIEWS.docs = () => {
  const sub = S.sub.docs; const td = T();
  const ds = live('docs');
  const cats = DOC_CATS.filter(c => ds.some(d => d.category === c));
  const head = tabsHtml('docs', [['all', 'All', ds.length], ['expiring', 'Expiring'], ...cats.map(c => [c, c]), ['archived', 'Archived']]);
  if (sub === 'archived') return head + archivedView(['docs']);
  let list = ds;
  if (sub === 'expiring') list = ds.filter(d => [d.expiry, d.renewal].some(x => L.isDate(x) && x <= L.addDays(td, 90)));
  else if (sub !== 'all') list = ds.filter(d => d.category === sub);
  list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const storageLbl = d => d.storage === 'file' && d.file ? '<span class="pill ok">Stored file</span>' : d.storage === 'link' && d.link ? '<span class="pill">Link</span>' : '<span class="pill">Details only</span>';
  return head + `<div class="note" style="margin-bottom:12px;display:block"><span class="small">This is an index. Each entry is either a <b>stored file</b> (uploaded to your private Supabase storage, up to 20 MB each), a <b>link</b> to where the file lives (Google Drive, OneDrive, iCloud, email), or <b>details only</b> (no file attached). For IDs and other highly sensitive papers, prefer a link to your own storage.</span></div>
  <div class="hstack" style="margin-bottom:12px"><button class="btn primary sm" data-act="new" data-c="docs">Add document</button></div>
  <div class="card"><div class="card-b list">${list.length ? list.map(d => { const rel = relatedLabel(d.related);
    return `<div class="row"><button class="row-main" data-act="edit" data-c="docs" data-id="${esc(d.id)}"><span class="row-title">${esc(d.title)}</span><span class="row-sub">${dotFor(d)}${storageLbl(d)}<span>${esc(d.category || 'Other')}</span>${(d.tags || []).map(t => `<span>#${esc(t)}</span>`).join('')}${L.isDate(d.expiry) ? `<span class="${d.expiry < td ? 'pill over' : L.diffDays(td, d.expiry) <= 30 ? 'pill soon' : ''}">Expires ${esc(L.fmtDate(d.expiry))}</span>` : ''}${L.isDate(d.renewal) ? `<span class="${d.renewal < td ? 'pill over' : L.diffDays(td, d.renewal) <= 30 ? 'pill soon' : ''}">Renew ${esc(L.fmtDate(d.renewal))}</span>` : ''}${rel ? `<span>↔ ${esc(rel)}</span>` : ''}</span></button>
      ${d.storage === 'file' && d.file && d.file.path ? `<button class="btn sm" data-act="open-file" data-id="${esc(d.id)}">Open</button>` : d.storage === 'link' && /^https?:\/\//i.test(d.link || '') ? `<a class="btn sm" href="${esc(d.link)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}</div>`; }).join('') : emptyState(sub === 'expiring' ? 'Nothing expiring in the next 90 days.' : 'No documents yet.')}</div></div>`;
};
function relatedLabel(rel) {
  if (!rel || !rel.c || !rel.id) return '';
  const r = get(rel.c, rel.id); if (!r) return `${COLL_LABEL[rel.c] || rel.c} (not found)`;
  return `${(COLL_LABEL[rel.c] || '').replace(/s$/, '')}: ${r.title || r.name || r.notes || L.money(r.amount)}`;
}

/* ---------- Reviews & Analytics ---------- */
function rangeNow() {
  const r = S.range; const a = r.anchor || T();
  if (r.kind === 'week') { const f = L.weekStart(a); return { from: f, to: L.addDays(f, 6), label: `Week of ${L.fmtDate(f)}` }; }
  if (r.kind === 'month') { const f = L.monthStart(a); return { from: f, to: L.monthEnd(f), label: `${L.MONTHS[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}` }; }
  return { from: r.from, to: r.to, label: `${L.fmtDate(r.from)} – ${L.fmtDate(r.to)}` };
}
function barsSvg(data, fmt, cls) {
  if (!data.length) return '';
  const max = Math.max(...data.map(d => d.value), 1);
  return `<div class="hbars" aria-hidden="true">${data.map(d => `<div class="hb"><span class="hb-l">${esc(d.label)}</span><span class="hb-t"><i style="width:${Math.max(1, 100 * Math.max(0, d.value) / max)}%"></i></span><span class="hb-v num">${esc(fmt(d.value))}</span></div>`).join('')}</div>`;
}
function colsSvg(data, fmt) {
  if (!data.length) return '';
  const max = Math.max(...data.map(d => d.value), 1); const w = 520, h = 160, pad = 24, bw = (w - pad * 2) / data.length;
  return `<div class="chart" aria-hidden="true"><svg viewBox="0 0 ${w} ${h + 22}"><line x1="${pad}" y1="${h}" x2="${w - pad}" y2="${h}" stroke="var(--line)"/>${data.map((d, i) => { const bh = (h - 24) * d.value / max; const x = pad + i * bw + bw * 0.2;
    return `<rect x="${x}" y="${h - bh}" width="${bw * 0.6}" height="${bh}" rx="3" fill="var(--accent)"/><text x="${x + bw * 0.3}" y="${h - bh - 5}" text-anchor="middle">${esc(fmt(d.value))}</text><text x="${x + bw * 0.3}" y="${h + 15}" text-anchor="middle">${esc(d.label)}</text>`; }).join('')}</svg></div>`;
}
function tableHtml(heads, rows) {
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${heads.map((h, i) => `<th class="${i ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'r' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
VIEWS.reviews = () => {
  const r = rangeNow(); const td = T(); const toEff = r.to < td ? r.to : td;
  const ctl = `<div class="hstack" style="margin-bottom:14px"><div class="seg" role="group" aria-label="Period">${[['week', 'Week'], ['month', 'Month'], ['custom', 'Custom']].map(([k, l]) => `<button type="button" data-act="range-kind" data-v="${k}" aria-pressed="${S.range.kind === k}">${l}</button>`).join('')}</div>
    ${S.range.kind !== 'custom' ? `<button class="icon-btn" data-act="range-step" data-v="-1" aria-label="Previous period">${ICON.left}</button><b>${esc(r.label)}</b><button class="icon-btn" data-act="range-step" data-v="1" aria-label="Next period">${ICON.right}</button>` :
      `<label class="hstack small">From <input type="date" id="rg-from" data-act-change="range-from" value="${S.range.from}" style="width:auto"></label><label class="hstack small">To <input type="date" id="rg-to" data-act-change="range-to" value="${S.range.to}" style="width:auto"></label>`}
    <span class="small muted">Scope: ${S.scope === 'all' ? 'All' : S.scope === 'work' ? 'Work' : 'Personal'}</span></div>`;
  if (r.from > r.to) return ctl + `<div class="note err">The start date is after the end date.</div>`;
  const tasks = live('tasks').concat(all('tasks').filter(t => t.archived && inScope(t) && t.status === 'done'));
  const ts = L.taskStats(tasks, r.from, r.to);
  const byProj = L.groupCount(ts.completedList, t => t.projectId ? (get('projects', t.projectId) || {}).name || 'Deleted project' : 'No project');
  const byCat = L.groupCount(ts.completedList, t => t.category || 'Uncategorised');
  const weekly = L.weeklyCompletions(tasks.filter(t => t.status !== 'cancelled'), 8, toEff);
  const weeksWithData = weekly.filter(w => w.value > 0).length;
  const sp = L.spendStats(live('expenses'), r.from, toEff);
  const months = S.range.kind === 'month' ? 1 : Math.max(1, L.diffDays(r.from, r.to) + 1) / 30.44;
  const buds = budgetsInScope();
  const trips = live('purchases').filter(p => p.date >= r.from && p.date <= r.to);
  const tripPriced = trips.flatMap(p => p.items || []).filter(i => i.price);
  const hs = live('habits'); const gs = live('goals');
  const bills = []; live('bills').forEach(b => L.billProjection(b, td, L.addDays(td, 30)).forEach(d => bills.push({ b, d })));

  const tasksSec = `<section class="card wide"><div class="card-h"><h2>Tasks</h2></div><div class="card-b">
    <div class="kpis"><div class="kpi"><b>${ts.completed}</b><span>Completed in period</span></div><div class="kpi"><b>${ts.onTimeRate == null ? '—' : pct(ts.onTimeRate)}</b><span>On-time ${ts.onTimeRate == null ? '(not enough data)' : `(${ts.onTime} of ${ts.withDue})`}</span></div><div class="kpi"><b>${ts.overdueNow}</b><span>Overdue now</span></div><div class="kpi"><b>${ts.dueInRange}</b><span>Due in period</span></div></div>
    <div class="def"><b>Completed</b>: tasks marked done with a completion time in the period (cancelled excluded). <b>On-time rate</b> = completed tasks finished on or before their due date and time ÷ completed tasks that had a due date; shown once there are at least 3. <b>Overdue now</b>: open tasks whose due date is before today.</div>
    <div class="sec-h"><h2>Completed per week (last 8 weeks)</h2></div>${weeksWithData >= 2 ? colsSvg(weekly.map(w => ({ label: L.fmtShort(w.key), value: w.value })), String) + tableHtml(['Week starting', 'Completed'], weekly.map(w => [L.fmtDate(w.key), w.value])) : '<div class="empty">Not enough data for a trend yet (needs completions in at least 2 weeks).</div>'}
    <div class="grid" style="margin-top:12px"><div><div class="sec-h"><h2>By project</h2></div>${byProj.length ? barsSvg(byProj.slice(0, 8).map(x => ({ label: x.key, value: x.value })), String) + tableHtml(['Project', 'Completed'], byProj.map(x => [x.key, x.value])) : '<div class="empty">No completions in this period.</div>'}</div>
    <div><div class="sec-h"><h2>By category</h2></div>${byCat.length ? barsSvg(byCat.slice(0, 8).map(x => ({ label: x.key, value: x.value })), String) + tableHtml(['Category', 'Completed'], byCat.map(x => [x.key, x.value])) : '<div class="empty">No completions in this period.</div>'}</div></div></div></section>`;
  const habitRows = hs.map(h => ({ h, s: L.habitStats(h, r.from, toEff) })).filter(x => x.s.scheduled + x.s.pending > 0);
  const habitSec = `<section class="card wide"><div class="card-h"><h2>Habits</h2></div><div class="card-b">${habitRows.length ? tableHtml(['Habit', 'Done', 'Skipped', 'Not recorded', 'Done of scheduled', 'Done of recorded', 'Streak'], habitRows.map(({ h, s }) => [h.title, s.done, s.skip, s.notRec, s.ofScheduled == null ? 'Not enough data' : pct(s.ofScheduled), s.ofRecorded == null ? 'Not enough data' : pct(s.ofRecorded), s.streak])) : '<div class="empty">No scheduled habit days in this period.</div>'}
    <div class="def"><b>Done of scheduled</b> = done ÷ scheduled days up to yesterday (skipped and not-recorded days included; today is excluded until recorded). <b>Done of recorded</b> = done ÷ (done + skipped), ignoring days with no record. Not recorded is shown separately and is never counted as a confirmed miss. Skipped days pause a streak rather than break it.</div></div></section>`;
  const goalSec = `<section class="card wide"><div class="card-h"><h2>Goals</h2></div><div class="card-b">${gs.length ? tableHtml(['Goal', 'Progress', 'Measure', 'Target date'], gs.map(g => { const p = L.goalProgress(g); return [g.title, p ? pct(p.pct) : 'No measure', p ? p.label : '—', g.targetDate ? L.fmtDate(g.targetDate) : '—']; })) : '<div class="empty">No goals yet.</div>'}
    <div class="def">Progress = (current − start) ÷ (target − start) for measurable goals, or completed ÷ total milestones. Goals without either show “No measure”.</div></div></section>`;
  const budRows = [...new Set([...sp.byCat.map(x => x.key), ...buds.map(b => b.category)])].map(k => { const v = (sp.byCat.find(x => x.key === k) || {}).value || 0; const b = Math.round(buds.filter(x => x.category === k).reduce((s, x) => s + (+x.amount || 0), 0) * months); return [k, v, b]; }).sort((a, b) => b[1] - a[1]);
  const moneySec = `<section class="card wide"><div class="card-h"><h2>Money</h2></div><div class="card-b">
    <div class="kpis"><div class="kpi"><b>${L.money(sp.total)}</b><span>Spent (${sp.count} entries)</span></div><div class="kpi"><b>${buds.length ? L.money(Math.round(buds.reduce((s, b) => s + (+b.amount || 0), 0) * months)) : '—'}</b><span>Budget for period${S.range.kind === 'month' ? '' : ' (pro-rated)'}</span></div><div class="kpi"><b>${L.money(bills.reduce((s, x) => s + (+x.b.amount || 0), 0))}</b><span>Bills due next 30 days (${bills.length})</span></div><div class="kpi"><b>${tripPriced.length ? L.money(tripPriced.reduce((s, i) => s + (+i.price || 0), 0)) : '—'}</b><span>Grocery spend ${tripPriced.length ? `(${trips.length} trips)` : '(no priced purchases)'}</span></div></div>
    <div class="def"><b>Spent</b> = expenses minus refunds dated in the period; transfers are excluded. Budgets are monthly and pro-rated for weeks and custom ranges. <b>Grocery spend</b> sums actual prices recorded on finished shopping trips only; it is a view of grocery purchases, not added to Spent a second time.</div>
    ${budRows.length ? barsSvg(budRows.slice(0, 10).map(x => ({ label: x[0], value: x[1] })), v => L.money(v)) + tableHtml(['Category', 'Spent', 'Budget', 'Difference'], budRows.map(x => [x[0], L.money(x[1]), x[2] ? L.money(x[2]) : '—', x[2] ? L.money(x[2] - x[1]) : '—'])) : '<div class="empty">No spending recorded in this period.</div>'}
    ${bills.length ? `<div class="sec-h"><h2>Upcoming bill commitments</h2></div>` + tableHtml(['Bill', 'Due', 'Amount'], bills.sort((a, b) => a.d.localeCompare(b.d)).map(x => [x.b.name, L.fmtDate(x.d), L.money(x.b.amount)])) : ''}</div></section>`;
  return ctl + weeklyReview(r) + `<div class="grid" style="margin-top:16px">${tasksSec}${habitSec}${goalSec}${moneySec}</div>`;
};
function weeklyReview(r) {
  const td = T();
  const unfinished = live('tasks').filter(t => isOpen(t) && (t.focus && t.focus >= r.from && t.focus <= r.to || (t.priority === 'high' && L.isDate(t.due) && t.due <= r.to))).slice(0, 8);
  const up = agendaItems(L.addDays(td, 1), L.addDays(td, 7)).filter(i => !i.done && ['deadline', 'appointment', 'bill', 'project', 'milestone', 'expiry', 'renewal'].includes(i.kind)).slice(0, 8);
  const sugg = [];
  const over = live('tasks').filter(t => isOpen(t) && L.isDate(t.due) && t.due < td);
  if (over.length >= 3) sugg.push(`Review the ${over.length} overdue tasks: reschedule, delegate or cancel the ones that no longer matter.`);
  if (all('inbox').filter(i => !i.archived).length) sugg.push('Clear the inbox so captured items get a date or a home.');
  const lowHabit = live('habits').map(h => ({ h, s: L.habitStats(h, L.addDays(td, -13), td) })).filter(x => x.s.ofRecorded != null && x.s.ofRecorded < 0.5);
  if (lowHabit.length) sugg.push(`“${lowHabit[0].h.title}” was done on fewer than half of recorded days in the last two weeks. Consider fewer scheduled days.`);
  const noNext = live('projects').filter(p => p.status !== 'done' && !all('tasks').some(t => t.projectId === p.id && isOpen(t)));
  if (noNext.length) sugg.push(`Add a next action to ${noNext.map(p => p.name).slice(0, 2).join(' and ')}.`);
  if (!(S.settings.budgets || []).length && live('expenses').length >= 10) sugg.push('Set a monthly budget for your top spending categories.');
  return `<section class="card"><div class="card-h"><h2>Review</h2><span class="small muted">${esc(r.label)}</span></div><div class="card-b stack">
    <div><div class="small muted" style="font-weight:700">Recorded facts</div>${weeklyFactsFor(r)}</div>
    <div class="grid"><div><div class="small muted" style="font-weight:700">Unfinished priorities</div>${unfinished.length ? `<div class="list">${unfinished.map(t => taskRow(t)).join('')}</div>` : '<div class="empty">None.</div>'}</div>
    <div><div class="small muted" style="font-weight:700">Next 7 days</div>${up.length ? `<div class="list">${up.map(agendaRow).join('')}</div>` : '<div class="empty">Nothing major scheduled.</div>'}</div></div>
    <div class="ai-box"><h3>Suggestions from planner rules</h3>${sugg.length ? `<ul style="margin:0;padding-left:18px">${sugg.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '<div class="small muted">No rule-based suggestions this period.</div>'}</div>

  </div></section>`;
}
function weeklyFactsFor(r) {
  const td = T(); const toEff = r.to < td ? r.to : td; const tasks = live('tasks');
  const ts = L.taskStats(tasks, r.from, toEff); const facts = [];
  facts.push(`${ts.completed} task${ts.completed === 1 ? '' : 's'} completed; ${ts.overdueNow} overdue now.`);
  if (ts.onTimeRate != null) facts.push(`On-time: ${pct(ts.onTimeRate)} (${ts.onTime} of ${ts.withDue} dated tasks).`);
  let hd = 0, hsch = 0; live('habits').forEach(h => { const s = L.habitStats(h, r.from, toEff); hd += s.done; hsch += s.scheduled; });
  if (hsch) facts.push(`Habits: ${hd} of ${hsch} scheduled check-ins done.`);
  const sp = L.spendStats(live('expenses'), r.from, toEff); if (sp.count) facts.push(`Spent ${L.money(sp.total)} across ${sp.count} entries${sp.byCat[0] ? `; largest category ${sp.byCat[0].key} (${L.money(sp.byCat[0].value)})` : ''}.`);
  const gd = live('goals').filter(g => g.status === 'done' && L.istDateOf(g.updatedAt) >= r.from && L.istDateOf(g.updatedAt) <= toEff).length; if (gd) facts.push(`${gd} goal${gd > 1 ? 's' : ''} marked achieved.`);
  return `<ul class="facts" id="facts-list" style="margin:4px 0 0;padding-left:18px">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
}

/* ---------- Settings ---------- */
VIEWS.settings = () => {
  const s = S.settings; const lay = s.layout;
  const counts = COLLS.map(c => [COLL_LABEL[c], S.data[c].size]);
  const capRow = (ok, name, desc) => `<div class="cap"><span class="pill ${ok === true ? 'ok' : ok === 'warn' ? 'soon' : ''}">${ok === true ? 'Works now' : ok === 'warn' ? 'Partial' : 'Not set up'}</span><div><b>${name}</b><div class="small muted">${desc}</div></div></div>`;
  return `<div class="grid">
  <section class="card"><div class="card-h"><h2>Appearance</h2></div><div class="card-b stack"><div class="choice" role="group" aria-label="Theme">${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" data-act="theme" data-v="${k}" aria-pressed="${s.theme === k}">${l}</button>`).join('')}</div>
    <div class="small muted">Dates: DD MMM YYYY · Time zone: Asia/Kolkata (IST) · Currency: INR</div></div></section>
  <section class="card"><div class="card-h"><h2>Work hours</h2></div><div class="card-b"><form class="stack" data-form="workhours"><div class="choice" role="group" aria-label="Work days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" data-act="toggle-chip" data-v="${d}" aria-pressed="${(s.workDays || []).includes(d)}">${L.WD[d]}</button>`).join('')}</div>
    <div class="f2"><label class="field"><span>Start</span><input type="time" name="start" id="wh-start" value="${esc(s.workStart)}"></label><label class="field"><span>End</span><input type="time" name="end" id="wh-end" value="${esc(s.workEnd)}"></label></div><div><button class="btn sm primary" type="submit">Save work hours</button></div></form></div></section>
  <section class="card" id="layout"><div class="card-h"><h2>Dashboard sections</h2></div><div class="card-b">${lay.map((x, i) => { const d = DASH.find(q => q.id === x.id); return `<div class="layout-row"><span>${esc(d.label)}</span>
      <button class="icon-btn" data-act="lay-move" data-v="${i}" data-d="-1" aria-label="Move ${esc(d.label)} up" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button><button class="icon-btn" data-act="lay-move" data-v="${i}" data-d="1" aria-label="Move ${esc(d.label)} down" ${i === lay.length - 1 ? 'disabled' : ''}>${ICON.down}</button>
      <button class="btn sm ${x.hidden ? '' : 'ghost'}" data-act="lay-hide" data-v="${x.id}" aria-pressed="${!x.hidden}">${x.hidden ? 'Hidden' : 'Shown'}</button></div>`; }).join('')}</div></section>
  <section class="card wide"><div class="card-h"><h2>What works now</h2></div><div class="card-b cap-list">
    ${capRow(S.mode === 'cloud' ? true : null, 'Sync between Windows and iPhone', S.mode === 'cloud' ? `Signed in as ${esc(Cloud.email)}. Data lives in your own Supabase database and syncs live between devices. A copy stays on each device for offline use.` : 'Not signed in.')}
    ${capRow(S.mode === 'cloud' ? true : null, 'Stored files for documents and receipts', 'Private Supabase storage, up to 20 MB per file (1 GB free in total).')}
    ${capRow(true, 'Backup (JSON) and CSV export', 'Downloads to your device; on iPhone it opens the share sheet so you can save to Files.')}
    ${capRow(feedState() === 'scheduled' ? true : (S.settings.feed && S.settings.feed.token) ? 'warn' : null, 'Reminders when the app is closed', 'Through a private calendar link your iPhone subscribes to. Set up in Calendar → Reminders.')}
    ${capRow(true, 'Install as an app', 'iPhone: open in Safari → Share → Add to Home Screen. Windows: Edge or Chrome → Install icon in the address bar.')}
    ${capRow(null, 'Writing to Google/Outlook calendars', 'Not built in; the planner only publishes a read-only feed that calendars subscribe to.')}
    ${capRow(null, 'Bank or card imports', 'Manual entry only. Restore from a JSON backup is supported.')}
    ${S.mode === 'cloud' ? `<div class="hstack" style="margin-top:6px"><button class="btn sm ghost" data-act="sign-out">Sign out of this device</button></div>` : ''}
  </div></section>
  <section class="card wide"><div class="card-h"><h2>Backup, restore &amp; export</h2></div><div class="card-b stack">
    <div class="hstack"><button class="btn primary sm" data-act="backup">Download full backup (JSON)</button><button class="btn sm" data-act="restore-backup">Restore from backup…</button></div>
    <div class="hstack">${[['tasks', 'Tasks'], ['expenses', 'Expenses'], ['bills', 'Bills'], ['purchases', 'Grocery purchases'], ['habits', 'Habit log'], ['goals', 'Goals'], ['docs', 'Documents index']].map(([k, l]) => `<button class="btn sm ghost" data-act="csv" data-v="${k}">${l} CSV</button>`).join('')}</div>
    <div class="def">Backups include every record, its ID and its links (task ↔ project, expense ↔ receipt, bill ↔ payment), plus settings. Uploaded files themselves are not inside the JSON; their entries are. Restoring merges: matching IDs are updated only when the backup copy is newer, and nothing is deleted.</div>
    <div class="tbl-wrap">${tableHtml(['Records', 'Count'], counts)}</div></div></section>
  <section class="card"><div class="card-h"><h2>Preview</h2></div><div class="card-b stack"><div class="small muted">Explore the planner filled with sample data. Your real records stay untouched and nothing in preview is saved.</div><div>${S.preview ? '<button class="btn sm" data-act="exit-preview">Exit preview</button>' : '<button class="btn sm" data-act="enter-preview">Preview with sample data</button>'}</div></div></section>
  </div>`;
};
/* ===== Editors, actions, quick add, search, backup ===== */
const fld = (label, inner, hint, name) => `<label class="field"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}<span class="err" data-err="${name || ''}" hidden></span></label>`;
const inp = (name, val, type, attrs) => `<input type="${type || 'text'}" name="${name}" id="f-${name}" value="${esc(val ?? '')}" ${attrs || ''}>`;
const sel = (name, list, val, blank) => `<select name="${name}" id="f-${name}">${opts(list, val, blank)}</select>`;
const area = (name, val) => `<textarea name="${name}" id="f-${name}">${esc(val ?? '')}</textarea>`;
const chk = (name, val, label) => `<label class="hstack" style="min-height:36px"><input type="checkbox" name="${name}" id="f-${name}" ${val ? 'checked' : ''} style="width:20px;height:20px"> <span>${label}</span></label>`;
function scopeChoice(v) {
  v = v === 'work' ? 'work' : 'personal';
  return `<div class="field"><span>Area</span><div class="choice" role="group" aria-label="Area"><button type="button" data-act="pick" data-name="scope" data-v="personal" aria-pressed="${v === 'personal'}">Personal</button><button type="button" data-act="pick" data-name="scope" data-v="work" aria-pressed="${v === 'work'}">Work</button></div><input type="hidden" name="scope" value="${v}"></div>`;
}
const LI_TPL = {
  subtasks: (x = {}) => `<div class="hstack" data-li data-id="${esc(x.id || uid())}" style="flex-wrap:nowrap"><input type="checkbox" data-k="done" ${x.done ? 'checked' : ''} aria-label="Done" style="width:20px;height:20px;flex:none"><input type="text" data-k="text" value="${esc(x.text || '')}" placeholder="Step" aria-label="Step"><button type="button" class="icon-btn" data-act="li-del" aria-label="Remove step">${ICON.close}</button></div>`,
  milestones: (x = {}) => `<div class="hstack" data-li data-id="${esc(x.id || uid())}" style="flex-wrap:nowrap"><input type="checkbox" data-k="done" ${x.done ? 'checked' : ''} aria-label="Done" style="width:20px;height:20px;flex:none"><input type="text" data-k="text" value="${esc(x.title || x.text || '')}" placeholder="Milestone" aria-label="Milestone"><input type="date" data-k="due" value="${esc(x.due || '')}" aria-label="Milestone date" style="width:150px;flex:none"><button type="button" class="icon-btn" data-act="li-del" aria-label="Remove milestone">${ICON.close}</button></div>`
};
const listField = (name, items, addLabel) => `<div class="field"><span>${name === 'subtasks' ? 'Checklist' : 'Milestones'}</span><div class="stack" style="gap:6px" data-list="${name}">${(items || []).map(LI_TPL[name]).join('')}</div><div><button type="button" class="btn sm ghost" data-act="li-add" data-list="${name}">+ ${addLabel}</button></div></div>`;
function readList(form, name) {
  return [...form.querySelectorAll(`[data-list="${name}"] [data-li]`)].map(li => {
    const text = li.querySelector('[data-k=text]').value.trim(); if (!text) return null;
    const o = { id: li.dataset.id, done: !!(li.querySelector('[data-k=done]') || {}).checked };
    if (name === 'milestones') { o.title = text; o.due = (li.querySelector('[data-k=due]') || {}).value || null; } else o.text = text;
    return o;
  }).filter(Boolean);
}
function reminderFields(rem, hint) {
  rem = rem || {}; const st = remState(rem) || 'not_configured';
  return `<details class="more-f" ${rem.at ? 'open' : ''}><summary>Reminder ${rem.at ? `· <span class="pill ${st === 'not_configured' ? '' : st}">${REM_STATUS[st]}</span>` : ''}</summary><div class="stack" style="margin-top:8px">
    ${fld('Remind me at (IST)', inp('rem_at', rem.at || '', 'datetime-local'), hint || 'The alert comes from your subscribed calendar (Calendar → Reminders). Until that is set up and tested, this stays “Not configured”.', 'rem_at')}
    ${rem.at ? chk('rem_clear', false, 'Remove this reminder') : ''}</div></details>`;
}
function readReminder(fd, old) {
  if (fd.get('rem_clear')) return null;
  const at = fd.get('rem_at'); if (!at) return null;
  return { at: String(at).slice(0, 16), tz: 'Asia/Kolkata' };
}
function recurField(r, label) { return fld(label || 'Repeats', sel('recur', RECUR_OPTS, r && r.freq || '')); }
function readRecur(fd, date) { const f = fd.get('recur'); if (!f) return null; return { freq: f, interval: 1, anchorDay: L.isDate(date) ? +date.slice(8) : undefined }; }
const tagsStr = t => (t || []).join(', ');
const readTags = s => [...new Set(String(s || '').split(/[,\s]+/).map(x => x.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
function docOptions(val, filterCat) {
  const ds = all('docs').filter(d => !d.archived && (!filterCat || d.category === filterCat || d.id === val)).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return ds.map(d => [d.id, d.title]);
}

/* ---------- sheet ---------- */
function openSheet(title, body, foot, wide) {
  const sh = $('#sheet');
  sh.innerHTML = `<div class="sheet-h"><h2 id="sheet-title">${esc(title)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${ICON.close}</button></div><div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ''}`;
  sh.hidden = false; $('#scrim').hidden = false;
  setTimeout(() => { const f = sh.querySelector('[autofocus]') || sh.querySelector('input:not([type=hidden]),textarea,select'); if (f && window.matchMedia('(min-width: 861px)').matches) f.focus(); }, 30);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; S.editing = null; if ($('#qa').hidden) $('#scrim').hidden = true; }

/* ---------- editors ---------- */
const NEW = {
  tasks: p => ({ title: '', scope: defScope('tasks'), priority: '', status: 'todo', due: null, dueTime: null, subtasks: [], tags: [], ...p }),
  projects: p => ({ name: '', scope: defScope('projects'), status: 'active', milestones: [], notes: [], ...p }),
  events: p => ({ title: '', kind: 'appointment', scope: defScope('events'), date: S.calSel || T(), allDay: false, start: '', end: '', ...p }),
  goals: p => ({ title: '', scope: defScope('goals'), status: 'active', metric: { unit: '', start: '', target: '', current: '' }, milestones: [], ...p }),
  habits: p => ({ title: '', scope: defScope('habits'), days: [0, 1, 2, 3, 4, 5, 6], startDate: T(), log: {}, ...p }),
  groceries: p => ({ name: '', qty: null, unit: '', category: 'Other', status: 'needed', scope: 'personal', ...p }),
  pantry: p => ({ name: '', qty: '', unit: '', min: '', scope: 'personal', ...p }),
  expenses: p => ({ date: T(), amount: '', category: 'Other', scope: defScope('expenses'), kind: 'expense', notes: '', ...p }),
  bills: p => ({ name: '', amount: '', scope: defScope('bills'), category: 'Bills & Utilities', freq: 'monthly', nextDue: T(), subscription: false, autopay: false, payments: [], ...p }),
  docs: p => ({ title: '', scope: defScope('docs'), category: S.scope === 'work' ? 'Work' : 'Personal', tags: [], storage: 'link', link: '', ...p })
};
function defScope(c) { return S.scope !== 'all' ? S.scope : lsGet('lastScope.' + c, 'personal'); }
const TITLE = { tasks: 'task', projects: 'project', events: 'calendar item', goals: 'goal', habits: 'habit', groceries: 'grocery item', pantry: 'pantry item', expenses: 'expense', bills: 'bill', docs: 'document' };

function openEditor(c, id, prefill, extra) {
  const cur = id ? get(c, id) : null;
  if (id && !cur) { toast('That record no longer exists.'); return; }
  const r = cur ? clone(cur) : NEW[c](prefill || {});
  S.editing = Object.assign({ c, id: r.id || null, baseRev: cur ? (cur.rev || 0) : null, isNew: !cur, rec: r }, extra || {});
  const B = FORMS[c](r);
  const foot = `${!S.editing.isNew ? `<button type="button" class="btn ghost sp" data-act="archive" data-c="${c}" data-id="${esc(r.id)}">${r.archived ? 'Restore' : 'Archive'}</button>` : '<span class="sp"></span>'}<button type="button" class="btn" data-act="close-sheet">Cancel</button><button type="submit" form="sheet-form" class="btn primary">Save</button>`;
  openSheet((S.editing.isNew ? 'New ' : 'Edit ') + TITLE[c], `<div id="conflict"></div><form id="sheet-form" data-form="editor" class="stack" novalidate>${B}</form>`, foot);
}
const FORMS = {
  tasks: t => {
    const projs = all('projects').filter(p => !p.archived || p.id === t.projectId).map(p => [p.id, p.name + (p.scope === 'work' ? ' (Work)' : '')]);
    return `${fld('Task', inp('title', t.title, 'text', 'required autofocus autocomplete="off"'), null, 'title')}
    ${scopeChoice(t.scope)}
    <div class="f2">${fld('Due date', inp('due', t.due || '', 'date'), null, 'due')}${fld('Time', inp('dueTime', t.dueTime || '', 'time'))}</div>
    <div class="f2">${fld('Priority', sel('priority', [['high', 'High'], ['med', 'Medium'], ['low', 'Low']], t.priority, 'None'))}${fld('Status', sel('status', [['todo', 'To do'], ['doing', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done'], ['cancelled', 'Cancelled']], t.status || 'todo'))}</div>
    <details class="more-f" ${t.projectId || t.category || (t.tags || []).length || t.notes || (t.subtasks || []).length ? 'open' : ''}><summary>Details</summary><div class="stack" style="margin-top:8px">
      <div class="f2">${fld('Project', sel('projectId', projs, t.projectId, 'No project'))}${fld('Category', sel('category', TASK_CATS, t.category, 'None'))}</div>
      <div class="f2">${fld('Tags', inp('tags', tagsStr(t.tags), 'text', 'placeholder="comma separated"'))}${fld('Estimate (minutes)', inp('estMin', t.estMin || '', 'number', 'min="0" step="5" inputmode="numeric"'))}</div>
      ${fld('Notes', area('notes', t.notes))}
      ${listField('subtasks', t.subtasks, 'Add step')}
      ${fld('Source link', inp('link', t.link || '', 'url', 'placeholder="https://"'), null, 'link')}
      ${fld('Related document', sel('docId', docOptions(t.docId), t.docId, 'None'))}</div></details>
    <details class="more-f" ${t.recur ? 'open' : ''}><summary>Repeat</summary><div class="stack" style="margin-top:8px">${recurField(t.recur)}<small class="faint">Completing a repeating task keeps it in history and creates the next one on or after today.</small></div></details>
    ${reminderFields(t.reminder)}
    ${t.completedAt ? `<div class="small muted">Completed ${esc(L.fmtStamp(t.completedAt))}</div>` : ''}${t.seriesId ? `<div class="small muted">Part of a repeating series (${all('tasks').filter(x => x.seriesId === t.seriesId && x.status === 'done').length} completed so far).</div>` : ''}`;
  },
  projects: p => `${fld('Project name', inp('name', p.name, 'text', 'required autofocus'), null, 'name')}${scopeChoice(p.scope)}
    <div class="f2">${fld('Status', sel('status', [['active', 'Active'], ['onhold', 'On hold'], ['done', 'Completed']], p.status || 'active'))}${fld('Deadline', inp('deadline', p.deadline || '', 'date'))}</div>
    ${fld('Description', area('description', p.description))}${listField('milestones', p.milestones, 'Add milestone')}`,
  events: e => `${fld('Title', inp('title', e.title, 'text', 'required autofocus'), null, 'title')}
    <div class="field"><span>Type</span><div class="choice" role="group">${Object.entries(EVENT_KINDS).map(([k, l]) => `<button type="button" data-act="pick" data-name="kind" data-v="${k}" aria-pressed="${(e.kind || 'appointment') === k}">${l}</button>`).join('')}</div><input type="hidden" name="kind" value="${esc(e.kind || 'appointment')}"></div>
    ${scopeChoice(e.scope)}
    <div class="f3">${fld('Date', inp('date', e.date, 'date', 'required'), null, 'date')}${fld('Start', inp('start', e.start || '', 'time'))}${fld('End', inp('end', e.end || '', 'time'), null, 'end')}</div>
    ${chk('allDay', e.allDay, 'All day')}
    <div class="f2">${recurField(e.recur)}${fld('Repeat until', inp('until', e.recur && e.recur.until || '', 'date'))}</div>
    ${fld('Location', inp('location', e.location || ''))}${fld('Notes', area('notes', e.notes))}${reminderFields(e.reminder)}
    <div class="small muted">Saved to this planner only. Nothing is added to an external calendar.</div>`,
  goals: g => `${fld('Goal', inp('title', g.title, 'text', 'required autofocus'), null, 'title')}${scopeChoice(g.scope)}
    <div class="f2">${fld('Category', inp('category', g.category || '', 'text', 'placeholder="e.g. Health, Career"'))}${fld('Target date', inp('targetDate', g.targetDate || '', 'date'))}</div>
    <fieldset class="stack" style="border:1px solid var(--line);border-radius:var(--r-sm);padding:10px"><legend class="small muted" style="font-weight:600">Measurable target (optional)</legend>
    <div class="f2">${fld('Unit', inp('m_unit', g.metric && g.metric.unit || '', 'text', 'placeholder="books, km, ₹"'))}${fld('Start value', inp('m_start', g.metric && g.metric.start, 'number', 'step="any"'))}</div>
    <div class="f2">${fld('Target value', inp('m_target', g.metric && g.metric.target, 'number', 'step="any"'), null, 'm_target')}${fld('Current value', inp('m_current', g.metric && g.metric.current, 'number', 'step="any"'))}</div></fieldset>
    ${listField('milestones', g.milestones, 'Add milestone')}${fld('Next action', inp('nextAction', g.nextAction || ''))}
    ${fld('Status', sel('status', [['active', 'Active'], ['done', 'Achieved'], ['paused', 'Paused']], g.status || 'active'))}${fld('Notes', area('notes', g.notes))}
    ${(g.history || []).length ? `<div class="small muted">Recent updates: ${(g.history || []).slice(-5).reverse().map(h => `${esc(L.fmtShort(h.date))}: ${esc(h.value)}`).join(' · ')}</div>` : ''}`,
  habits: h => `${fld('Habit', inp('title', h.title, 'text', 'required autofocus'), null, 'title')}${scopeChoice(h.scope)}
    <div class="field"><span>Scheduled days</span><div class="choice" role="group" data-chips="days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" data-act="toggle-chip" data-v="${d}" aria-pressed="${!h.days || !h.days.length || h.days.includes(d)}">${L.WD[d]}</button>`).join('')}</div><span class="err" data-err="days" hidden></span></div>
    ${fld('Tracking starts', inp('startDate', h.startDate || T(), 'date'), 'Days before this are never counted.')}${fld('Notes', area('notes', h.notes))}
    ${reminderFields(h.reminder, 'The time is used on each scheduled day. Alerts come from your subscribed calendar.')}`,
  groceries: g => `${fld('Item', inp('name', g.name, 'text', 'required autofocus'), null, 'name')}
    <div class="f3">${fld('Quantity', inp('qty', g.qty ?? '', 'number', 'step="any" min="0" inputmode="decimal"'))}${fld('Unit', inp('unit', g.unit || '', 'text', 'placeholder="kg, pcs"'))}${fld('Category', sel('category', GROC_CATS, g.category || 'Other'))}</div>
    <div class="f2">${fld('Status', sel('status', [['needed', 'Needed'], ['bought', 'Bought']], g.status || 'needed'))}${fld('Store', inp('store', g.store || '', 'text', 'list="stores"'))}</div>
    <datalist id="stores">${[...new Set(all('groceries').map(x => x.store).concat(all('purchases').map(x => x.store)).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <div class="f2">${fld('Estimated price (₹)', inp('price', g.price || '', 'number', 'step="any" min="0" inputmode="decimal"'))}${fld('Actual price (₹)', inp('actual', g.actual || '', 'number', 'step="any" min="0" inputmode="decimal"'))}</div>
    ${chk('restock', g.restock, 'Running low (restock)')}${scopeChoice(g.scope)}`,
  pantry: p => `${fld('Item', inp('name', p.name, 'text', 'required autofocus'), null, 'name')}
    <div class="f3">${fld('Quantity on hand', inp('qty', p.qty ?? '', 'number', 'step="any" min="0" inputmode="decimal"'))}${fld('Unit', inp('unit', p.unit || ''))}${fld('Restock at', inp('min', p.min ?? '', 'number', 'step="any" min="0" inputmode="decimal"'))}</div>
    <small class="faint">Leave quantity blank if you don't track it. Shopping suggestions only use items with both a quantity and a restock level.</small>${fld('Notes', area('notes', p.notes))}`,
  expenses: e => `<div class="f2">${fld('Amount (₹)', inp('amount', e.amount, 'number', 'required step="0.01" min="0" inputmode="decimal" autofocus'), null, 'amount')}${fld('Date', inp('date', e.date, 'date', 'required'), null, 'date')}</div>
    ${fld('What for', inp('notes', e.notes || '', 'text', 'placeholder="e.g. Lunch with team"'))}
    <div class="f2">${fld('Category', sel('category', EXP_CATS, e.category || 'Other'))}${fld('Type', sel('kind', [['expense', 'Expense'], ['refund', 'Refund (reduces spending)'], ['transfer', 'Transfer (not spending)']], e.kind || 'expense'))}</div>
    ${scopeChoice(e.scope)}
    ${fld('Receipt', sel('docId', docOptions(e.docId), e.docId, 'No receipt linked'), 'Link a receipt from Documents, or add one after saving.')}${chk('addReceipt', false, 'Add a new receipt after saving')}
    <div id="dupe-warn"></div>${e.billId ? `<div class="small muted">Payment for bill: ${esc((get('bills', e.billId) || {}).name || 'deleted bill')}</div>` : ''}${e.tripId ? '<div class="small muted">Recorded from a grocery trip.</div>' : ''}`,
  bills: b => `${fld('Name', inp('name', b.name, 'text', 'required autofocus placeholder="e.g. Electricity, Netflix"'), null, 'name')}
    <div class="f2">${fld('Amount (₹)', inp('amount', b.amount, 'number', 'required step="0.01" min="0" inputmode="decimal"'), null, 'amount')}${fld('Next due', inp('nextDue', b.nextDue || '', 'date'), 'Leave empty once fully settled.', 'nextDue')}</div>
    <div class="f2">${fld('Repeats', sel('freq', [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly'], ['weekly', 'Weekly'], ['once', 'One-time']], b.freq || 'monthly'))}${fld('Category', sel('category', EXP_CATS, b.category || 'Bills & Utilities'))}</div>
    ${scopeChoice(b.scope)}${chk('subscription', b.subscription, 'Subscription')}${chk('autopay', b.autopay, 'Paid automatically (autopay)')}${fld('Notes', area('notes', b.notes))}${reminderFields(b.reminder)}
    ${(b.payments || []).length ? `<div class="field"><span>Payment history</span>${tableHtml(['Due', 'Paid on', 'Expense'], (b.payments || []).slice().reverse().map(p => [L.fmtDate(p.due), L.fmtDate(p.paidOn), p.expenseId && get('expenses', p.expenseId) ? L.money(get('expenses', p.expenseId).amount) : '—']))}</div>` : ''}`,
  docs: d => {
    const relOpts = [['', 'None'], ...all('projects').filter(p => !p.archived).map(p => ['projects:' + p.id, 'Project: ' + p.name]), ...all('expenses').filter(e => !e.archived).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 60).map(e => ['expenses:' + e.id, `Expense: ${L.fmtShort(e.date)} ${e.notes || e.category} ${L.money(e.amount)}`]), ...all('bills').filter(b => !b.archived).map(b => ['bills:' + b.id, 'Bill: ' + b.name]), ...all('tasks').filter(t => !t.archived && isOpen(t)).slice(0, 60).map(t => ['tasks:' + t.id, 'Task: ' + t.title]), ...all('goals').filter(g => !g.archived).map(g => ['goals:' + g.id, 'Goal: ' + g.title])];
    const relVal = d.related && d.related.c ? d.related.c + ':' + d.related.id : '';
    const st = d.storage || 'link';
    return `${fld('Title', inp('title', d.title, 'text', 'required autofocus'), null, 'title')}${scopeChoice(d.scope)}
    <div class="f2">${fld('Category', sel('category', DOC_CATS, d.category || 'Other'))}${fld('Tags', inp('tags', tagsStr(d.tags), 'text', 'placeholder="comma separated"'))}</div>
    <div class="field"><span>Where the file is</span><div class="choice" role="group">${[['file', 'Stored file'], ['link', 'Link'], ['none', 'Details only']].map(([k, l]) => `<button type="button" data-act="pick" data-name="storage" data-v="${k}" aria-pressed="${st === k}">${l}</button>`).join('')}</div><input type="hidden" name="storage" value="${st}"></div>
    <div data-show="storage:link" ${st === 'link' ? '' : 'hidden'}>${fld('Link to the file', inp('link', d.link || '', 'url', 'placeholder="https://drive.google.com/…"'), 'Google Drive, OneDrive, iCloud or any web link. The planner stores only the link.', 'link')}</div>
    <div data-show="storage:file" ${st === 'file' ? '' : 'hidden'}>${filesOn() || S.preview ? `${d.file ? `<div class="small hstack" style="margin-bottom:6px">Stored: <b>${esc(d.file.name)}</b> (${Math.round((d.file.size || 0) / 1024)} KB) <button type="button" class="btn sm" data-act="open-file" data-id="${esc(d.id)}">Open</button></div>` : ''}${fld(d.file ? 'Replace file' : 'Choose file', `<input type="file" name="file" id="f-file" accept="image/*,application/pdf,.txt,.csv,.json,.md">`, 'Images, PDF or text, up to 20 MB. Stored privately in your own Supabase storage.', 'file')}` : '<div class="note warn small">File uploads need a connection. Use a link, or try again when online.</div>'}</div>
    ${fld('Related record', sel('related', relOpts, relVal))}
    <div class="f2">${fld('Expiry date', inp('expiry', d.expiry || '', 'date'))}${fld('Renewal date', inp('renewal', d.renewal || '', 'date'))}</div>${fld('Notes', area('notes', d.notes))}`;
  }
};
function setErr(form, name, msg) { const e = form.querySelector(`[data-err="${name}"]`); if (e) { e.textContent = msg; e.hidden = false; } const i = form.querySelector(`[name="${name}"]`); if (i) i.setAttribute('aria-invalid', 'true'); }
const num = v => v === '' || v == null ? null : (isFinite(+v) ? +v : NaN);
const validUrl = s => !s || /^https?:\/\/[^\s]+$/i.test(s);

async function saveEditor(form, force) {
  const ed = S.editing; if (!ed) return;
  form.querySelectorAll('.err').forEach(e => { e.hidden = true; }); form.querySelectorAll('[aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
  const fd = new FormData(form); const c = ed.c; const r = clone(ed.rec); let bad = false;
  const req = (n, msg) => { if (!String(fd.get(n) || '').trim()) { setErr(form, n, msg || 'Required'); bad = true; } };
  const g = n => String(fd.get(n) ?? '').trim();
  if (c === 'tasks') {
    req('title', 'Give the task a title');
    Object.assign(r, { title: g('title'), scope: g('scope'), due: g('due') || null, dueTime: g('dueTime') || null, priority: g('priority'), status: g('status') || 'todo', projectId: g('projectId') || null, category: g('category'), tags: readTags(g('tags')), estMin: num(g('estMin')) || null, notes: g('notes'), subtasks: readList(form, 'subtasks'), link: g('link'), docId: g('docId') || null, recur: readRecur(fd, g('due')), reminder: readReminder(fd, r.reminder) });
    if (r.dueTime && !r.due) { setErr(form, 'due', 'Add a date for this time'); bad = true; }
    if (!validUrl(r.link)) { setErr(form, 'link', 'Use a full web address starting with https://'); bad = true; }
    if (r.status === 'done' && !r.completedAt) r.completedAt = nowIso(); if (r.status !== 'done') r.completedAt = null;
  } else if (c === 'projects') {
    req('name'); Object.assign(r, { name: g('name'), scope: g('scope'), status: g('status'), deadline: g('deadline') || null, description: g('description'), milestones: readList(form, 'milestones') });
  } else if (c === 'events') {
    req('title'); req('date', 'Pick a date');
    Object.assign(r, { title: g('title'), kind: g('kind') || 'appointment', scope: g('scope'), date: g('date'), allDay: !!fd.get('allDay'), start: g('start'), end: g('end'), location: g('location'), notes: g('notes'), reminder: readReminder(fd, r.reminder) });
    r.recur = readRecur(fd, r.date); if (r.recur && g('until')) r.recur.until = g('until');
    if (r.start && r.end && r.end <= r.start) { setErr(form, 'end', 'End must be after start'); bad = true; }
  } else if (c === 'goals') {
    req('title'); const m = { unit: g('m_unit'), start: num(g('m_start')), target: num(g('m_target')), current: num(g('m_current')) };
    if ([m.start, m.target, m.current].some(x => Number.isNaN(x))) { setErr(form, 'm_target', 'Use numbers only'); bad = true; }
    if (m.target != null && m.target === (m.start || 0)) { setErr(form, 'm_target', 'Target must differ from the start value'); bad = true; }
    const prevCur = r.metric && r.metric.current;
    Object.assign(r, { title: g('title'), scope: g('scope'), category: g('category'), targetDate: g('targetDate') || null, metric: m.target == null ? null : m, milestones: readList(form, 'milestones'), nextAction: g('nextAction'), status: g('status'), notes: g('notes') });
    if (m.current != null && m.current !== prevCur) r.history = (r.history || []).concat([{ date: T(), value: m.current }]).slice(-200);
  } else if (c === 'habits') {
    req('title'); const days = [...form.querySelectorAll('[data-chips="days"] button[aria-pressed="true"]')].map(b => +b.dataset.v);
    if (!days.length) { setErr(form, 'days', 'Pick at least one day'); bad = true; }
    Object.assign(r, { title: g('title'), scope: g('scope'), days, startDate: g('startDate') || T(), notes: g('notes'), reminder: readReminder(fd, r.reminder) });
  } else if (c === 'groceries') {
    req('name'); const was = r.status;
    Object.assign(r, { name: g('name'), qty: num(g('qty')), unit: g('unit'), category: g('category'), status: g('status'), store: g('store'), price: num(g('price')), actual: num(g('actual')), restock: !!fd.get('restock'), scope: g('scope') });
    if (r.status === 'bought' && was !== 'bought') r.boughtAt = nowIso();
  } else if (c === 'pantry') {
    req('name'); Object.assign(r, { name: g('name'), qty: num(g('qty')), unit: g('unit'), min: num(g('min')), notes: g('notes') });
  } else if (c === 'expenses') {
    const a = num(g('amount')); if (!(a > 0)) { setErr(form, 'amount', 'Enter an amount above zero'); bad = true; }
    req('date', 'Pick a date');
    Object.assign(r, { amount: L.round2(a), date: g('date'), notes: g('notes'), category: g('category'), kind: g('kind'), scope: g('scope'), docId: g('docId') || null });
    if (!bad && !force && !ed.dupeOk) {
      const d = L.findDuplicates(r, all('expenses'));
      if (d.length) { $('#dupe-warn').innerHTML = `<div class="note warn"><span>Possible duplicate: ${esc(d[0].notes || d[0].category)} · ${L.money(d[0].amount)} on ${esc(L.fmtDate(d[0].date))} is already recorded.</span><button type="button" class="btn sm" data-act="dupe-ok">Save anyway</button></div>`; return; }
    }
  } else if (c === 'bills') {
    req('name'); const a = num(g('amount')); if (!(a >= 0) || g('amount') === '') { setErr(form, 'amount', 'Enter the amount'); bad = true; }
    Object.assign(r, { name: g('name'), amount: L.round2(a), nextDue: g('nextDue') || null, freq: g('freq'), category: g('category'), scope: g('scope'), subscription: !!fd.get('subscription'), autopay: !!fd.get('autopay'), notes: g('notes'), reminder: readReminder(fd, r.reminder) });
    if (r.nextDue) r.anchorDay = +r.nextDue.slice(8);
  } else if (c === 'docs') {
    req('title'); const rel = g('related');
    Object.assign(r, { title: g('title'), scope: g('scope'), category: g('category'), tags: readTags(g('tags')), storage: g('storage'), link: g('link'), related: rel ? { c: rel.split(':')[0], id: rel.split(':').slice(1).join(':') } : null, expiry: g('expiry') || null, renewal: g('renewal') || null, notes: g('notes') });
    if (r.storage === 'link' && !validUrl(r.link)) { setErr(form, 'link', 'Use a full web address starting with https://'); bad = true; }
    const file = form.querySelector('#f-file') && form.querySelector('#f-file').files[0];
    if (r.storage === 'file' && !file && !r.file) { setErr(form, 'file', 'Choose a file, or switch to Link or Details only'); bad = true; }
    if (!bad && r.storage === 'file' && file) {
      if (file.size > 20 * 1024 * 1024) { setErr(form, 'file', 'This file is over 20 MB'); return; }
      if (S.preview) { r.file = { name: file.name, size: file.size, path: '' }; }
      else {
        try { toast('Uploading ' + file.name + '…'); const old = r.file; r.file = await Cloud.upload(file); if (old && old.path) Cloud.removeFile(old.path).catch(() => {}); }
        catch (e) { setErr(form, 'file', 'Upload failed (' + (e && e.code || 'error') + '). The document was not saved.'); return; }
      }
    }
  }
  if (bad) { const f = form.querySelector('[aria-invalid="true"]'); if (f) f.focus(); return; }
  // stale-write protection
  if (!ed.isNew && !force) {
    const cur = get(c, ed.id);
    if (!cur || (cur.rev || 0) !== ed.baseRev) {
      $('#conflict').innerHTML = `<div class="note err" style="margin-bottom:12px"><span>${cur ? 'This item was changed on another device after you opened it.' : 'This item was deleted on another device.'}</span><button type="button" class="btn sm" data-act="reload-editor">Load latest</button><button type="button" class="btn sm danger" data-act="force-save">Save my version</button></div>`;
      $('#sheet .sheet-b').scrollTop = 0; return;
    }
    r.rev = cur.rev;
  }
  if (ed.isNew) { r.id = r.id || uid(); r.archived = false; }
  lsSet('lastScope.' + c, r.scope);
  let nextOcc = null;
  if (c === 'tasks' && r.status === 'done' && ed.rec.status !== 'done' && r.recur && r.recur.freq) {
    const cr = L.completeTask(r, r.completedAt || nowIso(), T()); Object.assign(r, cr.done); nextOcc = cr.next;
  }
  const saved = await put(c, r);
  if (!saved) return;
  if (nextOcc && !get('tasks', nextOcc.id)) await put('tasks', nextOcc);
  if (ed.fromInbox) await remove('inbox', ed.fromInbox);
  const addReceipt = c === 'expenses' && fd.get('addReceipt');
  closeSheet();
  if (ed.isNew) offerUndo(`${TITLE[c][0].toUpperCase() + TITLE[c].slice(1)} added`, [{ c, createdId: saved.id }]); else toast('Saved');
  if (addReceipt) openEditor('docs', null, { title: 'Receipt · ' + (saved.notes || saved.category) + ' · ' + L.fmtShort(saved.date), category: 'Receipt', storage: filesOn() ? 'file' : 'link', scope: saved.scope, related: { c: 'expenses', id: saved.id } }, { linkExpense: saved.id });
  if (c === 'docs' && ed.linkExpense) { const e = get('expenses', ed.linkExpense); if (e) { const x = clone(e); x.docId = saved.id; await put('expenses', x); } }
}

/* ---------- task actions ---------- */
async function toggleTask(id) {
  const t = get('tasks', id); if (!t) return;
  if (t.status === 'done') {
    const r = clone(t); r.status = 'todo'; r.completedAt = null;
    const ops = [{ c: 'tasks', before: clone(t) }];
    await put('tasks', r);
    const nx = t.nextId && get('tasks', t.nextId);
    if (nx && nx.status === 'todo' && (nx.rev || 0) <= 1) { ops.push({ c: 'tasks', before: clone(nx) }); await remove('tasks', nx.id); }
    offerUndo('Marked not done', ops); return;
  }
  const { done, next } = L.completeTask(clone(t), nowIso(), T());
  const ops = [{ c: 'tasks', before: clone(t) }];
  await put('tasks', done);
  if (next && !get('tasks', next.id)) { await put('tasks', next); ops.push({ c: 'tasks', createdId: next.id }); }
  offerUndo(next ? `Done · next on ${L.fmtDate(next.due)}` : 'Done', ops);
}
async function postpone(id) {
  const t = get('tasks', id); if (!t) return; const td = T();
  const r = clone(t); const tm = L.addDays(td, 1);
  r.due = (!L.isDate(t.due) || t.due < tm) ? tm : L.addDays(t.due, 1);
  await put('tasks', r); offerUndo(`Moved to ${L.relDay(r.due)}`, [{ c: 'tasks', before: clone(t) }]);
}
async function togglePin(id) {
  const t = get('tasks', id); if (!t) return; const td = T();
  if (t.focus === td) { const r = clone(t); r.focus = null; await put('tasks', r); return; }
  const pinned = live('tasks').filter(x => isOpen(x) && x.focus === td).length;
  if (pinned >= 3) { toast('Top 3 is full. Unpin one first.'); return; }
  const r = clone(t); r.focus = td; await put('tasks', r); toast('Pinned to today\'s top 3');
}
async function archiveRec(c, id, restore) {
  const r0 = get(c, id); if (!r0) return; const r = clone(r0); r.archived = !restore;
  await put(c, r); closeSheet();
  offerUndo(restore ? 'Restored' : 'Archived', [{ c, before: clone(r0) }]);
}
async function purgeRec(c, id) {
  const r = get(c, id); if (!r) return;
  if (c === 'docs' && r.file && r.file.path && cloudOn()) { try { await Cloud.removeFile(r.file.path); } catch (e) { /* file may already be gone */ } }
  if (await remove(c, id)) toast('Deleted permanently');
}

/* ---------- calendar feed ---------- */
function newToken() { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, x => x.toString(36).padStart(2, '0')).join('').slice(0, 40); }
async function feedCreate() { await saveSettings({ feed: { token: newToken(), enabled: true, createdAt: nowIso(), lastTest: null, subscribedOn: [] } }); toast('Calendar link created. Test it next.'); }
async function feedTest() {
  const f = S.settings.feed; if (!f || !f.token) return;
  if (S.preview) { toast('Not available in preview'); return; }
  const btn = document.querySelector('[data-act="feed-test"]'); if (btn) { btn.disabled = true; btn.textContent = 'Testing…'; }
  let res;
  try {
    const r = await fetch(Cloud.feedUrl(f.token), { cache: 'no-store' });
    const t = await r.text();
    if (r.ok && t.includes('BEGIN:VCALENDAR')) res = { ok: true, at: nowIso(), events: (t.match(/BEGIN:VEVENT/g) || []).length };
    else res = { ok: false, at: nowIso(), msg: r.status === 404 ? 'The calendar function answered "not found". Check that it is deployed as "calendar" and that the link was saved (wait a few seconds after creating it).' : r.status === 401 ? 'The calendar function is asking for sign-in. Turn off JWT verification for it (see the setup guide).' : 'Unexpected answer (' + r.status + ').' };
  } catch (e) { res = { ok: false, at: nowIso(), msg: 'Could not reach the calendar function. Is it deployed? Are you online?' }; }
  await saveSettings({ feed: Object.assign({}, S.settings.feed, { lastTest: res }) });
  toast(res.ok ? `Feed works · ${res.events} item${res.events === 1 ? '' : 's'}` : 'Feed test failed');
}
async function feedSet(patch) { await saveSettings({ feed: Object.assign({}, S.settings.feed || {}, patch) }); }
/* ---------- quick add ---------- */
const QA = { type: lsGet('qaType', 'tasks'), dirty: {} };
const QA_TYPES = [['tasks', 'Task'], ['expenses', 'Expense'], ['groceries', 'Grocery'], ['events', 'Event'], ['inbox', 'Inbox note']];
const QA_HINT = { tasks: 'Call bank tomorrow 4pm #work !high', expenses: '250 lunch · 1,200 uber yesterday #work', groceries: '2 kg rice · milk x2', events: 'Dentist fri 10am', inbox: 'Anything you want to sort later' };
function openQuickAdd(type) {
  if (type) QA.type = type; QA.dirty = {};
  const q = $('#qa');
  q.innerHTML = `<form data-form="qa" novalidate><div class="sheet-h" style="border-radius:14px 14px 0 0"><h2>Quick add</h2><button type="button" class="icon-btn" data-act="close-qa" aria-label="Close">${ICON.close}</button></div>
    <div class="qa-b"><div class="choice" role="group" aria-label="Type">${QA_TYPES.map(([k, l]) => `<button type="button" data-act="qa-type" data-v="${k}" aria-pressed="${QA.type === k}">${l}</button>`).join('')}</div>
    <input type="text" id="qa-text" name="text" autocomplete="off" placeholder="${esc(QA_HINT[QA.type])}" aria-label="What to add" enterkeyhint="done">
    <div class="preview" id="qa-prev"></div>
    <div class="hstack"><button type="button" class="btn ghost sm" data-act="qa-more">More details…</button><span style="margin-left:auto"></span><button type="submit" class="btn primary">Save</button></div></div></form>`;
  q.hidden = false; $('#scrim').hidden = false; qaPreview();
  setTimeout(() => $('#qa-text').focus(), 20);
}
function closeQA() { $('#qa').hidden = true; if ($('#sheet').hidden) $('#scrim').hidden = true; }
function qaParsed() {
  const text = ($('#qa-text') || {}).value || ''; const t = QA.type;
  if (t === 'tasks') { const p = L.parseTask(text); return { title: p.title, due: p.due || '', dueTime: p.dueTime || '', scope: p.scope || defScope('tasks'), priority: p.priority || '', tags: p.tags }; }
  if (t === 'expenses') { const p = L.parseExpense(text); return { amount: p.amount ?? '', notes: p.note, category: p.category, date: p.date, scope: p.scope || defScope('expenses') }; }
  if (t === 'groceries') { const p = L.parseGrocery(text); return { name: p.name, qty: p.qty ?? '', unit: p.unit, category: p.category }; }
  if (t === 'events') { const p = L.parseTask(text); return { title: p.title, date: p.due || T(), start: p.dueTime || '', kind: 'appointment', scope: p.scope || defScope('events') }; }
  return { text };
}
function qaPreview() {
  const box = $('#qa-prev'); if (!box) return; const p = qaParsed(); const t = QA.type;
  const keep = {}; box.querySelectorAll('[data-qf]').forEach(el => { if (QA.dirty[el.dataset.qf]) keep[el.dataset.qf] = el.value; });
  const v = k => keep[k] != null ? keep[k] : (p[k] ?? '');
  const f = (k, label, type, extra) => `<label class="field"><span>${label}</span><input type="${type || 'text'}" data-qf="${k}" id="qf-${k}" value="${esc(v(k))}" ${extra || ''}></label>`;
  const s = (k, label, list) => `<label class="field"><span>${label}</span><select data-qf="${k}" id="qf-${k}">${opts(list, v(k))}</select></label>`;
  const sc = s('scope', 'Area', [['personal', 'Personal'], ['work', 'Work']]);
  let h = '<div class="small muted" style="font-weight:600">Check before saving</div>';
  if (t === 'tasks') h += `${f('title', 'Title')}<div class="f2">${f('due', 'Due', 'date')}${f('dueTime', 'Time', 'time')}</div><div class="f2">${s('priority', 'Priority', [['', 'None'], ['high', 'High'], ['med', 'Medium'], ['low', 'Low']])}${sc}</div>`;
  else if (t === 'expenses') h += `<div class="f2">${f('amount', 'Amount (₹)', 'number', 'step="0.01" min="0" inputmode="decimal"')}${f('date', 'Date', 'date')}</div>${f('notes', 'What for')}<div class="f2">${s('category', 'Category', EXP_CATS)}${sc}</div>`;
  else if (t === 'groceries') h += `${f('name', 'Item')}<div class="f3">${f('qty', 'Qty', 'number', 'step="any" min="0" inputmode="decimal"')}${f('unit', 'Unit')}${s('category', 'Category', GROC_CATS)}</div>`;
  else if (t === 'events') h += `${f('title', 'Title')}<div class="f2">${f('date', 'Date', 'date')}${f('start', 'Start', 'time')}</div><div class="f2">${s('kind', 'Type', Object.entries(EVENT_KINDS))}${sc}</div>`;
  else h = '<div class="small muted">Saved to your inbox. Sort it later from Tasks → Inbox.</div>';
  h += '<div class="err small" id="qa-err" hidden></div>';
  box.innerHTML = h;
}
async function qaSave(openMore) {
  const t = QA.type; const p = qaParsed();
  document.querySelectorAll('#qa-prev [data-qf]').forEach(el => { p[el.dataset.qf] = el.value; });
  const err = m => { const e = $('#qa-err'); if (e) { e.textContent = m; e.hidden = false; } };
  let rec;
  if (t === 'inbox') { if (!p.text.trim()) return err('Type something to capture.'); rec = { text: p.text.trim(), scope: S.scope === 'work' ? 'work' : 'personal' }; }
  else if (t === 'tasks') { if (!openMore && !String(p.title).trim()) return err('Add a title.'); rec = NEW.tasks({ title: String(p.title).trim(), due: p.due || null, dueTime: p.dueTime || null, priority: p.priority, scope: p.scope, tags: p.tags || [] }); if (rec.dueTime && !rec.due) rec.due = T(); }
  else if (t === 'expenses') { const a = num(p.amount); if (!openMore && !(a > 0)) return err('Add an amount above zero.'); rec = NEW.expenses({ amount: a > 0 ? L.round2(a) : '', notes: p.notes, category: p.category, date: p.date || T(), scope: p.scope }); }
  else if (t === 'groceries') { if (!openMore && !String(p.name).trim()) return err('Add an item name.'); rec = NEW.groceries({ name: String(p.name).trim(), qty: num(p.qty), unit: p.unit, category: p.category }); }
  else if (t === 'events') { if (!openMore && !String(p.title).trim()) return err('Add a title.'); rec = NEW.events({ title: String(p.title).trim(), date: p.date || T(), start: p.start, kind: p.kind, scope: p.scope }); }
  if (openMore && t !== 'inbox') { closeQA(); openEditor(t, null, rec); return; }
  if (t === 'expenses') { const d = L.findDuplicates(rec, all('expenses')); if (d.length && !QA.dupeOk) { QA.dupeOk = true; return err(`Looks like a duplicate of ${d[0].notes || d[0].category} on ${L.fmtDate(d[0].date)}. Tap Save again to keep both.`); } }
  QA.dupeOk = false;
  rec.id = uid(); if (rec.scope) lsSet('lastScope.' + t, rec.scope);
  const saved = await put(t, rec);
  closeQA(); if (!saved) return; // failed writes stay queued for Retry
  const what = t === 'tasks' ? (rec.due ? `Task added · ${L.relDay(rec.due)}${rec.dueTime ? ' ' + L.fmtTime(rec.dueTime) : ''}` : 'Task added · no date') : t === 'expenses' ? `${L.money(rec.amount)} recorded` : t === 'groceries' ? `${rec.name} added to groceries` : t === 'events' ? `Added to calendar · ${L.relDay(rec.date)}` : 'Captured to inbox';
  offerUndo(what, [{ c: t, createdId: saved.id }]);
}

/* ---------- search ---------- */
function openSearch(q) {
  openSheet('Search', `<input type="search" id="s-q" value="${esc(q || '')}" placeholder="Search tasks, notes, expenses, documents…" aria-label="Search" autocomplete="off" autofocus><div id="s-res" class="results" style="margin-top:8px"></div>`);
  const i = $('#s-q'); setTimeout(() => { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 40); runSearch(q || '');
}
function runSearch(q) {
  const out = $('#s-res'); if (!out) return; q = q.trim().toLowerCase();
  if (q.length < 2) { out.innerHTML = '<div class="empty">Type at least 2 characters. Searches every section, including archived items.</div>'; return; }
  const text = r => [r.title, r.name, r.text, r.notes, r.description, r.category, r.location, r.store, r.link, (r.tags || []).join(' '), r.amount != null ? String(r.amount) : '', (r.subtasks || []).map(s => s.text).join(' '), (r.notes && Array.isArray(r.notes) ? r.notes.map(n => n.title + ' ' + n.body).join(' ') : ''), (r.milestones || []).map(m => m.title).join(' ')].filter(x => typeof x === 'string').join(' ').toLowerCase();
  let html = ''; let n = 0;
  COLLS.forEach(c => {
    const hits = all(c).filter(r => inScope(r) && text(r).includes(q)).slice(0, 12); if (!hits.length) return; n += hits.length;
    html += `<div class="grp">${esc(COLL_LABEL[c])}</div><div class="list">${hits.map(r => `<div class="row"><button class="row-main" data-act="${c === 'inbox' ? 'go' : c === 'purchases' || c === 'meals' ? 'go' : 'edit'}" data-c="${c}" data-id="${esc(r.id)}" data-v="${c === 'inbox' ? 'tasks:inbox' : c === 'purchases' ? 'home:trips' : c === 'meals' ? 'home:meals' : ''}"><span class="row-title">${esc(r.title || r.name || r.text || r.notes || (c === 'purchases' ? 'Trip ' + L.fmtDate(r.date) : c === 'meals' ? 'Meal plan ' + r.id.slice(2) : '(untitled)'))}</span><span class="row-sub">${dotFor(r)}${r.archived ? '<span class="pill">Archived</span>' : ''}${r.due ? `<span>${esc(L.fmtDate(r.due))}</span>` : r.date ? `<span>${esc(L.fmtDate(r.date))}</span>` : ''}${r.amount ? `<span>${L.money(r.amount)}</span>` : ''}${r.status === 'done' ? '<span>Done</span>' : ''}</span></button></div>`).join('')}</div>`;
  });
  out.innerHTML = n ? html : `<div class="empty">No matches for “${esc(q)}”${S.scope !== 'all' ? ' in ' + S.scope + '. Switch scope to All to search everything' : ''}.</div>`;
}

/* ---------- export / backup / restore ---------- */
async function saveFile(filename, text) {
  const type = filename.endsWith('.json') ? 'application/json' : filename.endsWith('.csv') ? 'text/csv' : 'text/plain';
  const blob = new Blob([filename.endsWith('.csv') ? '\ufeff' + text : text], { type });
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  try {
    const file = new File([blob], filename, { type });
    if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast('Downloaded ' + filename);
}
const stamp = () => T().replace(/-/g, '');
function backupJson() {
  const data = {}; COLLS.forEach(c => { data[c] = all(c); });
  return JSON.stringify({ format: 'daybook-backup', version: 1, exportedAt: nowIso(), timezone: 'Asia/Kolkata', currency: 'INR', settings: S.settings, data }, null, 2);
}
const CSV_DEF = {
  tasks: [() => all('tasks'), [['ID', 'id'], ['Title', 'title'], ['Area', r => scopeOf(r)], ['Status', 'status'], ['Priority', 'priority'], ['Due', 'due'], ['Due time', 'dueTime'], ['Project', r => (get('projects', r.projectId) || {}).name || ''], ['Category', 'category'], ['Tags', 'tags'], ['Estimate min', 'estMin'], ['Completed at (IST)', r => r.completedAt ? L.fmtStamp(r.completedAt) : ''], ['Repeats', r => r.recur ? r.recur.freq : ''], ['Series', 'seriesId'], ['Archived', r => r.archived ? 'yes' : ''], ['Notes', 'notes']]],
  expenses: [() => all('expenses'), [['ID', 'id'], ['Date', 'date'], ['Amount INR', 'amount'], ['Type', r => r.kind || 'expense'], ['Category', 'category'], ['Area', r => scopeOf(r)], ['Notes', 'notes'], ['Bill', r => (get('bills', r.billId) || {}).name || ''], ['Receipt document', r => (get('docs', r.docId) || {}).title || ''], ['Archived', r => r.archived ? 'yes' : '']]],
  bills: [() => all('bills'), [['ID', 'id'], ['Name', 'name'], ['Amount INR', 'amount'], ['Repeats', 'freq'], ['Next due', 'nextDue'], ['Area', r => scopeOf(r)], ['Subscription', r => r.subscription ? 'yes' : ''], ['Autopay', r => r.autopay ? 'yes' : ''], ['Payments', r => (r.payments || []).map(p => `${p.due} paid ${p.paidOn}`)]]],
  purchases: [() => all('purchases').flatMap(p => (p.items || []).map(i => Object.assign({ trip: p.id, date: p.date, store: p.store }, i))), [['Trip', 'trip'], ['Date', 'date'], ['Store', 'store'], ['Item', 'name'], ['Qty', 'qty'], ['Unit', 'unit'], ['Category', 'category'], ['Price INR', 'price']]],
  habits: [() => all('habits').flatMap(h => Object.entries(h.log || {}).sort().map(([d, v]) => ({ habit: h.title, area: scopeOf(h), date: d, status: v === 'done' ? 'Completed' : 'Skipped' }))), [['Habit', 'habit'], ['Area', 'area'], ['Date', 'date'], ['Status', 'status']]],
  goals: [() => all('goals'), [['ID', 'id'], ['Goal', 'title'], ['Area', r => scopeOf(r)], ['Category', 'category'], ['Target date', 'targetDate'], ['Status', 'status'], ['Unit', r => r.metric ? r.metric.unit : ''], ['Start', r => r.metric ? r.metric.start : ''], ['Target', r => r.metric ? r.metric.target : ''], ['Current', r => r.metric ? r.metric.current : ''], ['Milestones done', r => `${(r.milestones || []).filter(m => m.done).length}/${(r.milestones || []).length}`], ['Next action', 'nextAction']]],
  docs: [() => all('docs'), [['ID', 'id'], ['Title', 'title'], ['Area', r => scopeOf(r)], ['Category', 'category'], ['Stored as', r => r.storage === 'file' && r.file ? 'Stored file: ' + r.file.name : r.storage === 'link' ? 'Link' : 'Details only'], ['Link', 'link'], ['Tags', 'tags'], ['Expiry', 'expiry'], ['Renewal', 'renewal'], ['Related', r => relatedLabel(r.related)], ['Notes', 'notes']]]
};
function exportCsv(k) { const [rows, cols] = CSV_DEF[k]; saveFile(`daybook-${k}-${stamp()}.csv`, L.toCSV(rows(), cols.map(([label, g]) => ({ label, get: typeof g === 'function' ? g : r => r[g] })))); }
const SEG_OK = id => typeof id === 'string' && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(id) && id !== '.' && id !== '..';
const REQ = { tasks: r => typeof r.title === 'string' && r.title.trim(), projects: r => typeof r.name === 'string' && r.name.trim(), events: r => r.title && L.isDate(r.date), goals: r => r.title, habits: r => r.title, groceries: r => r.name, purchases: r => L.isDate(r.date) && Array.isArray(r.items), pantry: r => r.name, meals: r => r.days && typeof r.days === 'object', expenses: r => L.isDate(r.date) && isFinite(+r.amount), bills: r => r.name && isFinite(+r.amount), docs: r => r.title, inbox: r => r.text };
function analyseBackup(text) {
  let j; try { j = JSON.parse(text); } catch (e) { return { error: 'This file is not valid JSON.' }; }
  if (!j || j.format !== 'daybook-backup' || typeof j.data !== 'object') return { error: 'This is not a Daybook backup file.' };
  const plan = { add: [], update: [], skip: 0, dup: 0, invalid: [], settings: j.settings || null };
  COLLS.forEach(c => {
    const rows = Array.isArray(j.data[c]) ? j.data[c] : [];
    rows.forEach(r => {
      if (!r || typeof r !== 'object' || !SEG_OK(r.id) || !REQ[c](r)) { plan.invalid.push(`${COLL_LABEL[c]}: ${String(r && (r.title || r.name || r.id) || 'unnamed').slice(0, 40)}`); return; }
      const cur = get(c, r.id);
      if (cur) { if (String(r.updatedAt || '') > String(cur.updatedAt || '')) plan.update.push({ c, r: Object.assign({}, r, { rev: cur.rev }) }); else plan.skip++; return; }
      if (c === 'expenses' && L.findDuplicates(r, all('expenses')).length) { plan.dup++; return; }
      plan.add.push({ c, r: Object.assign({}, r, { rev: 0 }) });
    });
  });
  return plan;
}
function showRestorePlan(plan) {
  if (plan.error) { openSheet('Restore', `<div class="note err">${esc(plan.error)}</div>`); return; }
  S.restorePlan = plan;
  openSheet('Restore from backup', `<div class="stack"><div class="kpis"><div class="kpi"><b>${plan.add.length}</b><span>New records</span></div><div class="kpi"><b>${plan.update.length}</b><span>Newer versions</span></div><div class="kpi"><b>${plan.skip}</b><span>Already up to date</span></div><div class="kpi"><b>${plan.dup}</b><span>Likely duplicate expenses skipped</span></div></div>
    ${plan.invalid.length ? `<div class="note warn" style="display:block"><b>${plan.invalid.length} invalid row${plan.invalid.length > 1 ? 's' : ''} will be skipped:</b><div class="small">${plan.invalid.slice(0, 8).map(esc).join('<br>')}${plan.invalid.length > 8 ? '<br>…' : ''}</div></div>` : ''}
    ${plan.settings ? chk('rs', false, 'Also replace settings (layout, budgets, work hours)') : ''}
    <div class="def">Restore merges into your current planner. Nothing is deleted. IDs are kept, so links between tasks, projects, expenses, receipts and bills stay intact. Uploaded files are not part of the backup.</div>
    ${S.preview ? '<div class="note warn">You are in preview; restoring here only affects the sample data.</div>' : ''}</div>`,
    `<span class="sp"></span><button class="btn" data-act="close-sheet">Cancel</button><button class="btn primary" data-act="do-restore" ${plan.add.length + plan.update.length || plan.settings ? '' : 'disabled'}>Import ${plan.add.length + plan.update.length} records</button>`);
}
async function doRestore() {
  const plan = S.restorePlan; if (!plan) return; const withSettings = $('#f-rs') && $('#f-rs').checked;
  const btn = document.querySelector('[data-act="do-restore"]'); if (btn) btn.disabled = true;
  let ok = 0, fail = 0; const items = plan.add.concat(plan.update);
  for (let i = 0; i < items.length; i++) {
    if (btn && i % 10 === 0) btn.textContent = `Importing ${i + 1} of ${items.length}…`;
    const r = items[i].r; const rev = r.rev; const res = await put(items[i].c, Object.assign({}, r, { rev }), true); res ? ok++ : fail++;
  }
  if (withSettings && plan.settings) await saveSettings(mergeSettings(plan.settings));
  S.restorePlan = null; closeSheet();
  toast(fail ? `Imported ${ok}; ${fail} failed. Use Retry from the status button.` : `Imported ${ok} records`);
}

/* ---------- preview data ---------- */
function sampleData() {
  const td = T(); const d = n => L.addDays(td, n); const now = nowIso(); const ago = n => new Date(Date.now() - n * 864e5).toISOString();
  const m = Object.fromEntries(COLLS.map(c => [c, new Map()]));
  const add = (c, r) => m[c].set(r.id, Object.assign({ createdAt: ago(20), updatedAt: now, rev: 1, archived: false }, r));
  add('projects', { id: 'sp1', name: 'Website refresh (sample)', scope: 'work', status: 'active', deadline: d(12), description: 'Sample project to show milestones and notes.', milestones: [{ id: 'm1', title: 'Wireframes approved', due: d(-3), done: true }, { id: 'm2', title: 'Content ready', due: d(5), done: false }], notes: [{ id: 'n1', date: d(-2), title: 'Kick-off', body: 'Agreed scope and owners.\nNext: draft page list.' }] });
  add('projects', { id: 'sp2', name: 'Home office setup (sample)', scope: 'personal', status: 'active', milestones: [], notes: [] });
  [['st1', 'Draft page list', 'work', d(0), '11:00', 'high', 'sp1', 'Deep work'], ['st2', 'Reply to vendor email', 'work', d(-2), null, 'med', null, 'Admin'], ['st3', 'Pay electricity bill', 'personal', d(0), null, 'high', null, 'Finance'], ['st4', 'Book eye check-up', 'personal', d(3), null, '', null, 'Health'], ['st5', 'Order monitor arm', 'personal', null, null, 'low', 'sp2', 'Home'], ['st6', 'Prepare weekly status', 'work', d(2), '16:00', 'med', 'sp1', 'Meetings'], ['st7', 'Fix leaking tap', 'personal', d(6), null, '', null, 'Home']]
    .forEach(([id, title, scope, due, dueTime, priority, projectId, category]) => add('tasks', { id, title, scope, due, dueTime, priority, projectId, category, status: 'todo', subtasks: id === 'st1' ? [{ id: 'a', text: 'Home', done: true }, { id: 'b', text: 'About', done: false }] : [], tags: [] }));
  m.tasks.get('st1').focus = td; m.tasks.get('st3').focus = td;
  m.tasks.get('st6').recur = { freq: 'weekly', interval: 1 };
  m.tasks.get('st4').reminder = { at: d(2) + 'T09:00', repeat: 'none', channel: 'push', status: 'not_configured' };
  [[-1, 'done', 'Sort receipts', -2], [-3, 'done', 'Renew library card', -3], [-6, 'done', 'Call plumber', -5], [-8, 'done', 'Send invoice', -9]].forEach(([c, s, t, due], i) => add('tasks', { id: 'sd' + i, title: t, scope: i % 2 ? 'work' : 'personal', status: s, due: d(due), completedAt: new Date(L.parseD(d(c)).getTime() + 6 * 3600e3).toISOString(), subtasks: [], tags: [] }));
  add('events', { id: 'se1', title: 'Team stand-up', kind: 'appointment', scope: 'work', date: d(-14), start: '10:00', end: '10:15', recur: { freq: 'weekdays', interval: 1 } });
  add('events', { id: 'se2', title: 'Focus block: design review', kind: 'block', scope: 'work', date: d(1), start: '14:00', end: '16:00' });
  add('events', { id: 'se3', title: "Parent's birthday (sample)", kind: 'date', scope: 'personal', date: d(9).replace(/^\d{4}/, '1960'), allDay: true, recur: { freq: 'yearly', interval: 1 } });
  add('habits', { id: 'sh1', title: 'Walk 30 minutes', scope: 'personal', days: [0, 1, 2, 3, 4, 5, 6], startDate: d(-20), log: Object.fromEntries(L.rangeDates(d(-20), d(-1)).filter((x, i) => i % 4 !== 2).map((x, i) => [x, i % 7 === 5 ? 'skip' : 'done'])) });
  add('habits', { id: 'sh2', title: 'Plan tomorrow', scope: 'work', days: [1, 2, 3, 4, 5], startDate: d(-20), log: Object.fromEntries(L.rangeDates(d(-20), d(-1)).filter(x => ![0, 6].includes(L.dow(x)) && x.slice(-1) !== '3').map(x => [x, 'done'])) });
  add('goals', { id: 'sg1', title: 'Read 12 books this year', scope: 'personal', category: 'Learning', targetDate: td.slice(0, 4) + '-12-31', status: 'active', metric: { unit: 'books', start: 0, target: 12, current: 8 }, milestones: [], nextAction: 'Pick the next book' });
  add('goals', { id: 'sg2', title: 'Launch the refreshed site', scope: 'work', category: 'Career', targetDate: d(20), status: 'active', metric: null, milestones: [{ id: 'g1', title: 'Design signed off', done: true }, { id: 'g2', title: 'Content migrated', done: false }, { id: 'g3', title: 'Go live', done: false }], nextAction: 'Draft page list' });
  [['Tomatoes', 1, 'kg', 'Produce'], ['Milk', 2, 'l', 'Dairy'], ['Atta', 5, 'kg', 'Staples'], ['Dishwash liquid', 1, '', 'Household'], ['Bananas', 6, '', 'Produce']].forEach(([n, q, u, cat], i) => add('groceries', { id: 'sgr' + i, name: n, qty: q, unit: u, category: cat, status: i === 4 ? 'bought' : 'needed', scope: 'personal' }));
  add('purchases', { id: 'spu1', date: d(-6), store: 'Local market', items: [{ name: 'Onions', qty: 2, unit: 'kg', category: 'Produce', price: 80 }, { name: 'Milk', qty: 2, unit: 'l', category: 'Dairy', price: 120 }, { name: 'Rice', qty: 5, unit: 'kg', category: 'Staples', price: 450 }], total: 650 });
  add('pantry', { id: 'spa1', name: 'Rice', qty: 1, unit: 'kg', min: 2 }); add('pantry', { id: 'spa2', name: 'Cooking oil', qty: 2, unit: 'l', min: 1 });
  [[-1, 320, 'Food & Dining', 'Lunch', 'personal'], [-2, 450, 'Transport', 'Cab to client', 'work'], [-4, 1299, 'Shopping', 'Desk lamp', 'personal'], [-6, 650, 'Groceries', 'Weekly groceries', 'personal'], [-9, 2400, 'Bills & Utilities', 'Broadband', 'personal'], [-10, 180, 'Food & Dining', 'Coffee', 'work']].forEach(([o, a, cat, n, s], i) => add('expenses', { id: 'sx' + i, date: d(o), amount: a, category: cat, notes: n, scope: s, kind: 'expense' }));
  add('bills', { id: 'sb1', name: 'Electricity', amount: 1850, scope: 'personal', category: 'Bills & Utilities', freq: 'monthly', nextDue: d(0), payments: [] });
  add('bills', { id: 'sb2', name: 'Music streaming', amount: 119, scope: 'personal', category: 'Entertainment', freq: 'monthly', nextDue: d(11), subscription: true, autopay: true, payments: [] });
  add('bills', { id: 'sb3', name: 'Design tool licence', amount: 1600, scope: 'work', category: 'Work', freq: 'monthly', nextDue: d(-2), subscription: true, payments: [] });
  add('docs', { id: 'sdoc1', title: 'Passport (sample entry)', scope: 'personal', category: 'ID & Legal', storage: 'none', expiry: d(45), tags: ['travel'] });
  add('docs', { id: 'sdoc2', title: 'Laptop warranty (sample)', scope: 'personal', category: 'Warranty', storage: 'link', link: 'https://example.com/warranty', expiry: d(20), tags: [] });
  add('inbox', { id: 'si1', text: 'Look into a standing desk' });
  return m;
}
function enterPreview() {
  if (S.preview) return; S.real = S.data; S.realSettings = S.settings;
  S.data = sampleData(); S.settings = mergeSettings(Object.assign(clone(S.settings), { budgets: [{ id: 'b1', category: 'Food & Dining', amount: 6000, scope: 'personal' }, { id: 'b2', category: 'Shopping', amount: 4000, scope: 'personal' }, { id: 'b3', category: 'Transport', amount: 3000, scope: 'work' }] }));
  S.preview = true; setStatus(); S.view = 'overview'; render(); window.scrollTo(0, 0);
}
function exitPreview() { if (!S.preview) return; S.data = S.real; S.settings = S.realSettings || S.settings; S.real = null; S.preview = false; applyTheme(); setStatus(); render(); }

/* ---------- action map ---------- */
function go(v) {
  const [view, sub] = String(v).split(':');
  if (!NAV.some(n => n.id === view)) return;
  S.view = view; if (sub && sub !== 'layout') { S.sub[view] = sub; lsSet('sub', S.sub); }
  try { history.replaceState(null, '', '#' + view); } catch (e) {}
  closeSheet(); render(); window.scrollTo(0, 0);
  if (sub === 'layout') setTimeout(() => { const el = document.getElementById('layout'); if (el) el.scrollIntoView(); }, 50);
}
const ACT = {
  nav: b => go(b.dataset.v), go: b => go(b.dataset.v),
  'more-nav': () => openSheet('Sections', `<div class="stack" style="gap:2px">${NAV.map(n => `<button type="button" class="nav-btn" style="min-height:48px" data-act="nav" data-v="${n.id}" ${n.id === S.view ? 'aria-current="page"' : ''}>${ICON[n.icon]}<span>${esc(n.label)}</span>${navBadge(n.id)}</button>`).join('')}</div>`),
  sub: b => { S.sub[b.dataset.k] = b.dataset.v; lsSet('sub', S.sub); render(); },
  'quick-add': () => openQuickAdd(), 'close-qa': closeQA, 'qa-type': b => { QA.type = b.dataset.v; lsSet('qaType', QA.type); const txt = $('#qa-text').value; openQuickAdd(); $('#qa-text').value = txt; qaPreview(); },
  'qa-more': () => qaSave(true),
  'close-sheet': closeSheet, 'open-search': () => openSearch(''),
  edit: b => { if (b.dataset.v) return go(b.dataset.v); openEditor(b.dataset.c, b.dataset.id); },
  new: b => { const p = {}; if (b.dataset.date) p.date = b.dataset.date; if (b.dataset.kind) p.kind = b.dataset.kind; if (b.dataset.cat) p.category = b.dataset.cat; openEditor(b.dataset.c, null, p); },
  pick: b => { const grp = b.closest('.field'); grp.querySelectorAll('[data-act="pick"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); grp.querySelector(`input[name="${b.dataset.name}"]`).value = b.dataset.v;
    const form = b.closest('form'); if (form) form.querySelectorAll(`[data-show^="${b.dataset.name}:"]`).forEach(el => { el.hidden = el.dataset.show !== b.dataset.name + ':' + b.dataset.v; }); },
  'toggle-chip': b => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')),
  'li-add': b => { const box = b.closest('.field').querySelector(`[data-list="${b.dataset.list}"]`); box.insertAdjacentHTML('beforeend', LI_TPL[b.dataset.list]()); box.lastElementChild.querySelector('[data-k=text]').focus(); },
  'li-del': b => b.closest('[data-li]').remove(),
  'toggle-task': b => toggleTask(b.dataset.id), postpone: b => postpone(b.dataset.id), focus: b => togglePin(b.dataset.id),
  archive: b => { const r = get(b.dataset.c, b.dataset.id); archiveRec(b.dataset.c, b.dataset.id, r && r.archived); },
  restore: b => archiveRec(b.dataset.c, b.dataset.id, true),
  purge: b => { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete forever'; b.classList.add('solid'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete permanently'; b.classList.remove('solid'); } }, 4000); return; } purgeRec(b.dataset.c, b.dataset.id); },
  'reload-editor': () => { const ed = S.editing; if (ed && get(ed.c, ed.id)) openEditor(ed.c, ed.id); else closeSheet(); },
  'force-save': () => saveEditor($('#sheet-form'), true),
  'dupe-ok': () => { S.editing.dupeOk = true; saveEditor($('#sheet-form')); },
  'open-project': b => { S.projectId = b.dataset.id; S.sub.tasks = 'project'; render(); window.scrollTo(0, 0); },
  'toggle-ms': async b => { const p = clone(get('projects', b.dataset.id)); const m = (p.milestones || []).find(x => x.id === b.dataset.m); if (!m) return; m.done = !m.done; await put('projects', p); },
  'toggle-gms': async b => { const g = clone(get('goals', b.dataset.id)); const m = (g.milestones || []).find(x => x.id === b.dataset.m); if (!m) return; m.done = !m.done; await put('goals', g); },
  'add-note': b => noteSheet(b.dataset.id), 'edit-note': b => noteSheet(b.dataset.id, b.dataset.n),
  'organise': b => { const i = get('inbox', b.dataset.id); if (!i) return; const c = b.dataset.c; let p = {};
    if (c === 'tasks') { const x = L.parseTask(i.text); p = { title: x.title || i.text, due: x.due, dueTime: x.dueTime, priority: x.priority || '', tags: x.tags, scope: x.scope || i.scope || 'personal' }; }
    else if (c === 'groceries') { const x = L.parseGrocery(i.text); p = { name: x.name, qty: x.qty, unit: x.unit, category: x.category }; }
    else if (c === 'expenses') { const x = L.parseExpense(i.text); p = { amount: x.amount || '', notes: x.note, category: x.category, date: x.date }; }
    else if (c === 'events') { const x = L.parseTask(i.text); p = { title: x.title || i.text, date: x.due || T(), start: x.dueTime || '' }; }
    else if (c === 'docs') p = { title: i.text };
    openEditor(c, null, p, { fromInbox: i.id }); },
  'inbox-del': async b => { const i = get('inbox', b.dataset.id); if (!i) return; await remove('inbox', i.id); offerUndo('Discarded', [{ c: 'inbox', before: clone(i) }]); },
  'habit-tap': async b => { const h0 = get('habits', b.dataset.id); if (!h0) return; const h = clone(h0); h.log = h.log || {}; const d = b.dataset.d; const v = h.log[d];
    if (!v) h.log[d] = 'done'; else if (v === 'done') h.log[d] = 'skip'; else delete h.log[d]; await put('habits', h); },
  'toggle-grocery': async b => { const g0 = get('groceries', b.dataset.id); if (!g0) return; const g = clone(g0); g.status = g.status === 'bought' ? 'needed' : 'bought'; g.boughtAt = g.status === 'bought' ? nowIso() : null; await put('groceries', g); },
  regrocery: async b => { const n = b.dataset.v; const last = all('purchases').flatMap(p => p.items || []).reverse().find(i => i.name === n) || all('groceries').find(g => g.name === n) || {};
    const r = NEW.groceries({ name: n, qty: last.qty ?? null, unit: last.unit || '', category: last.category || L.guessGroceryCat(n), store: last.store || '' }); r.id = uid(); const s = await put('groceries', r); if (s) offerUndo(`${n} added`, [{ c: 'groceries', createdId: s.id }]); },
  'add-pantry-sugg': async () => { const ids = []; for (const p of pantrySuggestions()) { const r = NEW.groceries({ name: p.name, unit: p.unit || '', category: L.guessGroceryCat(p.name), restock: true }); r.id = uid(); const s = await put('groceries', r); if (s) ids.push({ c: 'groceries', createdId: s.id }); } offerUndo(`${ids.length} item${ids.length === 1 ? '' : 's'} added from pantry`, ids); },
  'pantry-step': async b => { const p0 = get('pantry', b.dataset.id); if (!p0) return; const p = clone(p0); p.qty = Math.max(0, L.round2((+p.qty || 0) + (+b.dataset.v))); await put('pantry', p); },
  shop: () => { S.shopping = true; renderShopping(); }, 'shop-done': () => { S.shopping = false; renderShopping(); },
  'finish-trip': () => tripSheet(),
  'reuse-trip': async b => { const p = get('purchases', b.dataset.id); if (!p) return; const need = new Set(live('groceries').filter(g => g.status !== 'bought').map(g => g.name.toLowerCase())); const ids = [];
    for (const i of p.items || []) { if (need.has(i.name.toLowerCase())) continue; const r = NEW.groceries({ name: i.name, qty: i.qty ?? null, unit: i.unit || '', category: i.category || 'Other', store: p.store || '' }); r.id = uid(); const s = await put('groceries', r); if (s) ids.push({ c: 'groceries', createdId: s.id }); }
    offerUndo(`${ids.length} items added to the list`, ids); },
  'meal-week': b => { S.mealWeek = L.addDays(S.mealWeek, +b.dataset.v); render(); },
  'bill-paid': async b => { const b0 = get('bills', b.dataset.id); if (!b0 || !b0.nextDue) return; const bill = clone(b0);
    if ((bill.payments || []).some(p => p.due === bill.nextDue)) { toast('This due date is already marked paid.'); return; }
    const ex = { id: uid(), date: T(), amount: L.round2(bill.amount), category: bill.category || 'Bills & Utilities', notes: bill.name, scope: bill.scope, kind: 'expense', billId: bill.id };
    const saved = await put('expenses', ex); if (!saved) return;
    bill.payments = (bill.payments || []).concat([{ due: bill.nextDue, paidOn: T(), expenseId: saved.id }]);
    bill.nextDue = bill.freq === 'once' ? null : L.stepRecur(bill.nextDue, { freq: bill.freq, anchorDay: bill.anchorDay });
    await put('bills', bill); offerUndo(`Paid · ${L.money(ex.amount)} recorded${bill.nextDue ? ' · next ' + L.fmtDate(bill.nextDue) : ''}`, [{ c: 'bills', before: clone(b0) }, { c: 'expenses', createdId: saved.id }]); },
  'budget-del': async b => { await saveSettings({ budgets: (S.settings.budgets || []).filter(x => x.id !== b.dataset.id) }); },
  'money-month': b => { const v = +b.dataset.v; S.moneyMonth = v === 0 ? T().slice(0, 7) : L.addMonths(S.moneyMonth + '-01', v).slice(0, 7); render(); },
  'cal-month': b => { const v = +b.dataset.v; S.calMonth = v === 0 ? T().slice(0, 7) : L.addMonths(S.calMonth + '-01', v).slice(0, 7); if (v === 0) S.calSel = T(); render(); },
  'cal-sel': b => { S.calSel = b.dataset.v; if (b.dataset.v.slice(0, 7) !== S.calMonth) S.calMonth = b.dataset.v.slice(0, 7); render(); },
  'range-kind': b => { S.range.kind = b.dataset.v; S.range.anchor = T(); render(); },
  'range-step': b => { const v = +b.dataset.v; S.range.anchor = S.range.kind === 'week' ? L.addDays(S.range.anchor, 7 * v) : L.addMonths(L.monthStart(S.range.anchor), v); render(); },
  'feed-create': feedCreate, 'feed-test': () => feedTest(),
  'feed-rotate': async b => { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again: old link stops working'; return; } await saveSettings({ feed: { token: newToken(), enabled: true, createdAt: nowIso(), lastTest: null, subscribedOn: [] } }); toast('New link created. Re-subscribe your calendars with it.'); },
  'feed-toggle': () => feedSet({ enabled: !(S.settings.feed && S.settings.feed.enabled !== false) }),
  'feed-sub': b => { const cur = new Set((S.settings.feed || {}).subscribedOn || []); cur.has(b.dataset.v) ? cur.delete(b.dataset.v) : cur.add(b.dataset.v); feedSet({ subscribedOn: [...cur] }); },
  'open-file': async b => { const d = get('docs', b.dataset.id); if (!d || !d.file || !d.file.path) return; const w = window.open('', '_blank'); try { const url = await Cloud.fileUrl(d.file.path); if (w) w.location = url; else location.href = url; } catch (e) { if (w) w.close(); toast('Could not open the file: ' + errMsg(e)); } },
  'gate-preview': () => enterPreview(),
  'gate-reset': () => { Cloud.clearCfg(); S.mode = 'setup'; render(); },
  'sign-out': async () => { await Cloud.signOut(); S.failed = []; COLLS.forEach(c => S.data[c] = new Map()); S.mode = 'signin'; render(); },
  'resignin': async () => { await Cloud.signOut(); S.mode = 'signin'; S.dbError = null; S.authExpired = false; render(); },
  copy: async b => { const el = document.getElementById(b.dataset.target); const text = el.value != null && el.tagName === 'TEXTAREA' ? el.value : el.textContent;
    try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); if (el.select) el.select(); toast('Selected. Copy it with your device\'s Copy command.'); } },
  theme: b => saveSettings({ theme: b.dataset.v }),
  'dash-min': b => { const lay = clone(S.settings.layout); const x = lay.find(q => q.id === b.dataset.v); if (x) x.min = !x.min; saveSettings({ layout: lay }); },
  'lay-move': b => { const lay = clone(S.settings.layout); const i = +b.dataset.v, j = i + (+b.dataset.d); if (j < 0 || j >= lay.length) return; [lay[i], lay[j]] = [lay[j], lay[i]]; saveSettings({ layout: lay }); },
  'lay-hide': b => { const lay = clone(S.settings.layout); const x = lay.find(q => q.id === b.dataset.v); if (x) x.hidden = !x.hidden; saveSettings({ layout: lay }); },
  backup: () => saveFile(`daybook-backup-${stamp()}.json`, backupJson()),
  'restore-backup': () => { const f = $('#file-in'); f.accept = '.json,application/json'; f.value = ''; f.onchange = () => { const file = f.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = () => showRestorePlan(analyseBackup(String(rd.result))); rd.readAsText(file); }; f.click(); },
  'do-restore': doRestore, csv: b => exportCsv(b.dataset.v),
  'enter-preview': enterPreview, 'exit-preview': exitPreview,
  status: () => { if (S.failed.length || S.dbError) { S.dbError = null; return syncNow(); }
    openSheet('Saving & sync', `<div class="stack small"><div><b>Status:</b> ${esc($('#save-status').textContent)}</div>
      <div>${S.preview ? 'Preview mode: nothing is saved.' : S.mode === 'cloud' ? 'Every change is written to your Supabase database. The indicator shows Saving… until the write is confirmed. Offline changes are kept on this device and sync automatically when you reconnect; other failures show Save failed with a Retry.' : 'Not signed in.'}</div>
      <div class="def">Records: ${COLLS.map(c => `${COLL_LABEL[c]} ${S.data[c].size}`).join(' · ')}</div></div>`); }
};
function noteSheet(pid, nid) {
  const p = get('projects', pid); if (!p) return; const n = nid ? (p.notes || []).find(x => x.id === nid) : null;
  S.noteTarget = { pid, nid };
  openSheet(n ? 'Edit meeting note' : 'New meeting note', `<form id="note-form" data-form="note" class="stack">${fld('Title', `<input type="text" name="title" id="f-ntitle" value="${esc(n ? n.title : 'Meeting')}" autofocus>`)}${fld('Date', `<input type="date" name="date" id="f-ndate" value="${esc(n ? n.date : T())}" required>`)}${fld('Notes', `<textarea name="body" id="f-nbody" style="min-height:40vh">${esc(n ? n.body : '')}</textarea>`, 'Decisions, owners, follow-ups.')}</form>`,
    `${n ? '<button type="button" class="btn ghost danger sp" data-act="note-del">Delete note</button>' : '<span class="sp"></span>'}<button class="btn" data-act="close-sheet">Cancel</button><button type="submit" form="note-form" class="btn primary">Save note</button>`);
}
ACT['note-del'] = async () => { const t = S.noteTarget; const p0 = get('projects', t.pid); if (!p0) return; const p = clone(p0); p.notes = (p.notes || []).filter(x => x.id !== t.nid); await put('projects', p); closeSheet(); offerUndo('Note deleted', [{ c: 'projects', before: clone(p0) }]); };
function tripSheet() {
  const got = live('groceries').filter(g => g.status === 'bought'); if (!got.length) return;
  const stores = [...new Set(got.map(g => g.store).filter(Boolean))];
  openSheet('Finish shopping trip', `<form id="trip-form" data-form="trip" class="stack"><div class="f2">${fld('Date', `<input type="date" name="date" id="f-tdate" value="${T()}" required>`)}${fld('Store', `<input type="text" name="store" id="f-tstore" value="${esc(stores[0] || '')}">`)}</div>
    <div class="field"><span>Actual prices (optional)</span>${got.map(g => `<div class="hstack" style="flex-wrap:nowrap;min-height:44px"><span style="flex:1;min-width:0">${esc(g.name)} <span class="muted">${esc(g.qty || '')} ${esc(g.unit || '')}</span></span><input type="number" step="0.01" min="0" inputmode="decimal" name="p_${esc(g.id)}" id="f-p-${esc(g.id)}" value="${esc(g.actual || '')}" placeholder="₹" aria-label="Price of ${esc(g.name)}" style="width:110px"></div>`).join('')}</div>
    ${chk('asExpense', true, 'Record the total as one Groceries expense')}
    <div class="def">Bought items move to Purchase history and leave the list. Grocery analytics use the trip; the expense (if recorded) counts once in spending.</div></form>`,
    `<span class="sp"></span><button class="btn" data-act="close-sheet">Cancel</button><button type="submit" form="trip-form" class="btn primary">Finish trip</button>`);
}
async function finishTrip(form) {
  const fd = new FormData(form); const got = live('groceries').filter(g => g.status === 'bought');
  const items = got.map(g => { const v = num(fd.get('p_' + g.id)); return { name: g.name, qty: g.qty, unit: g.unit, category: g.category, price: v > 0 ? L.round2(v) : null, groceryId: g.id }; });
  const total = L.round2(items.reduce((s, i) => s + (i.price || 0), 0));
  const trip = { id: uid(), date: fd.get('date') || T(), store: String(fd.get('store') || '').trim(), items, total, scope: 'personal' };
  if (fd.get('asExpense') && total > 0) {
    const ex = { id: uid(), date: trip.date, amount: total, category: 'Groceries', notes: 'Groceries' + (trip.store ? ' · ' + trip.store : ''), scope: 'personal', kind: 'expense', tripId: trip.id };
    if (await put('expenses', ex)) trip.expenseId = ex.id;
  }
  const saved = await put('purchases', trip); if (!saved) return;
  for (const g of got) await remove('groceries', g.id);
  S.shopping = false; renderShopping(); closeSheet();
  offerUndo(`Trip saved · ${items.length} items${total ? ' · ' + L.money(total) : ''}`, [{ c: 'purchases', createdId: saved.id }, ...(trip.expenseId ? [{ c: 'expenses', createdId: trip.expenseId }] : []), ...got.map(g => ({ c: 'groceries', before: clone(g) }))]);
}
/* ---------- forms ---------- */
const FORM = {
  editor: f => saveEditor(f),
  qa: () => qaSave(false),
  note: async f => { const fd = new FormData(f); const t = S.noteTarget; const p0 = get('projects', t.pid); if (!p0) return; const p = clone(p0); p.notes = p.notes || [];
    const n = { id: t.nid || uid(), title: String(fd.get('title') || 'Meeting').trim(), date: fd.get('date') || T(), body: String(fd.get('body') || '') };
    const i = p.notes.findIndex(x => x.id === n.id); if (i >= 0) p.notes[i] = n; else p.notes.push(n); if (await put('projects', p)) { closeSheet(); toast('Note saved'); } },
  trip: f => finishTrip(f),
  'gate-setup': f => { const fd = new FormData(f); const url = String(fd.get('url') || '').trim(), key = String(fd.get('key') || '').trim(); const e = $('#gate-err');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url) && !/^https:\/\/.+/i.test(url)) { e.textContent = 'Paste the Project URL, e.g. https://abcd1234.supabase.co'; e.hidden = false; return; }
    if (key.length < 30) { e.textContent = 'Paste the publishable (anon) key. It is a long string.'; e.hidden = false; return; }
    if (/service_role|sb_secret_/i.test(key) || (key.split('.').length === 3 && /service_role/.test(atob(key.split('.')[1] || '') || ''))) { e.textContent = 'That is a secret key. Use the publishable (anon) key instead; never put the secret key in the app.'; e.hidden = false; return; }
    Cloud.setCfg(url, key); initStore(); },
  'gate-signin': async f => { const fd = new FormData(f); const e = $('#gate-err'); const btn = f.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Signing in…';
    try { await Cloud.signIn(String(fd.get('email')).trim(), String(fd.get('password'))); S.dbError = null; S.authExpired = false; startSync(); }
    catch (err) { e.textContent = /Invalid login/i.test(err.message) ? 'Email or password is wrong.' : /fetch|network/i.test(err.message) ? 'Can\'t reach your database. Check the connection or the Project URL.' : err.message; e.hidden = false; btn.disabled = false; btn.textContent = 'Sign in'; } },
  'inline-task': async f => { const i = f.querySelector('input'); const text = i.value.trim(); if (!text) return; const p = L.parseTask(text); if (!p.title) { toast('Add a title'); return; }
    const sub = S.sub.tasks; let due = p.due; if (!due && (sub === 'today' || sub === 'week' || sub === 'overdue')) due = T();
    const r = NEW.tasks({ title: p.title, due: due || null, dueTime: p.dueTime || null, priority: p.priority || '', scope: p.scope || defScope('tasks'), tags: p.tags }); if (r.dueTime && !r.due) r.due = T(); r.id = uid(); i.value = '';
    const s = await put('tasks', r); if (!s) return; $('#inline-task-preview').textContent = ''; offerUndo(r.due ? `Added · ${L.relDay(r.due)}${r.dueTime ? ' ' + L.fmtTime(r.dueTime) : ''}` : 'Added · no date', [{ c: 'tasks', createdId: s.id }]); },
  'project-task': async f => { const i = f.querySelector('input'); const text = i.value.trim(); if (!text) return; const p = L.parseTask(text); const proj = get('projects', f.dataset.id);
    const r = NEW.tasks({ title: p.title || text, due: p.due, dueTime: p.dueTime, priority: p.priority || '', projectId: f.dataset.id, scope: proj ? proj.scope : defScope('tasks'), tags: p.tags }); r.id = uid(); i.value = ''; await put('tasks', r); },
  'inline-inbox': async f => { const i = f.querySelector('input'); const text = i.value.trim(); if (!text) return; i.value = ''; await put('inbox', { id: uid(), text, scope: S.scope === 'work' ? 'work' : 'personal' }); },
  'inline-grocery': async f => { const i = f.querySelector('input'); const text = i.value.trim(); if (!text) return; const p = L.parseGrocery(text); if (!p.name) return;
    const r = NEW.groceries({ name: p.name, qty: p.qty, unit: p.unit, category: p.category }); r.id = uid(); i.value = ''; const s = await put('groceries', r); if (!s) return; $('#inline-grocery-preview').textContent = ''; offerUndo(`${p.name} added`, [{ c: 'groceries', createdId: s.id }]); },
  'inline-expense': async f => { const i = f.querySelector('input'); const text = i.value.trim(); if (!text) return; const p = L.parseExpense(text);
    if (!(p.amount > 0)) { $('#inline-expense-preview').innerHTML = '<span style="color:var(--danger)">Start with an amount, e.g. 250 lunch</span>'; return; }
    const r = NEW.expenses({ amount: L.round2(p.amount), notes: p.note, category: p.category, date: p.date, scope: p.scope || defScope('expenses') }); r.id = uid();
    if (L.findDuplicates(r, all('expenses')).length && f.dataset.dupe !== text) { f.dataset.dupe = text; $('#inline-expense-preview').innerHTML = '<span style="color:var(--warn)">An identical amount on that date is already recorded. Press Add again to keep both.</span>'; return; }
    delete f.dataset.dupe; i.value = ''; const s = await put('expenses', r); if (!s) return; $('#inline-expense-preview').textContent = ''; offerUndo(`${L.money(r.amount)} · ${r.category} recorded`, [{ c: 'expenses', createdId: s.id }]); },
  'goal-log': async f => { const v = num(new FormData(f).get('v')); if (v == null || Number.isNaN(v)) return; const g0 = get('goals', f.dataset.id); if (!g0) return; const g = clone(g0); g.metric = Object.assign({}, g.metric, { current: v }); g.history = (g.history || []).concat([{ date: T(), value: v }]).slice(-200);
    if (await put('goals', g)) { const reached = (+g.metric.target >= +(g.metric.start || 0)) ? v >= +g.metric.target : v <= +g.metric.target; if (reached && g.status !== 'done') toast('Target reached', { label: 'Mark achieved', fn: async () => { const x = clone(get('goals', g.id)); x.status = 'done'; await put('goals', x); } }); else offerUndo('Progress updated', [{ c: 'goals', before: clone(g0) }]); } },
  budget: async f => { const fd = new FormData(f); const a = num(fd.get('amount')); if (!(a >= 0)) return; const cat = fd.get('category'), scope = fd.get('scope');
    const bs = (S.settings.budgets || []).filter(b => !(b.category === cat && (b.scope || 'personal') === scope)); bs.push({ id: uid(), category: cat, amount: L.round2(a), scope });
    if (await saveSettings({ budgets: bs })) toast('Budget saved'); },
  workhours: async f => { const fd = new FormData(f); const days = [...f.querySelectorAll('[data-act="toggle-chip"][aria-pressed="true"]')].map(b => +b.dataset.v);
    if (await saveSettings({ workDays: days, workStart: fd.get('start'), workEnd: fd.get('end') })) toast('Work hours saved'); }
};
const CHANGE = {
  'task-filter': el => { S.taskFilter[el.dataset.k] = el.value; render(); },
  'group-groc': el => { S.groupGroceriesBy = el.value; render(); },
  'range-from': el => { if (L.isDate(el.value)) { S.range.from = el.value; render(); } },
  'range-to': el => { if (L.isDate(el.value)) { S.range.to = el.value; render(); } }
};

/* ---------- wiring ---------- */
function wire() {
  document.addEventListener('click', e => {
    const seg = e.target.closest('[data-seg="scope"] button');
    if (seg) { S.scope = seg.dataset.v; lsSet('scope', S.scope); render(); return; }
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const fn = ACT[b.dataset.act]; if (fn) { e.preventDefault(); fn(b, e); }
  });
  document.addEventListener('submit', e => { const f = e.target; const k = f.dataset.form; if (!k) return; e.preventDefault(); if (FORM[k]) FORM[k](f); });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.actChange && CHANGE[el.dataset.actChange]) return CHANGE[el.dataset.actChange](el);
    if (el.dataset.meal) return saveMeal(el);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.id === 'qa-text') { QA.dupeOk = false; qaPreview(); return; }
    if (el.dataset.qf) { QA.dirty[el.dataset.qf] = true; return; }
    if (el.id === 's-q') return runSearch(el.value);
    if (el.id === 'search') { const v = el.value; el.value = ''; openSearch(v); return; }
    if (el.id === 'inline-task') { const p = L.parseTask(el.value); const bits = []; if (p.due) bits.push('Due ' + L.relDay(p.due)); else if (['today', 'week', 'overdue'].includes(S.sub.tasks) && el.value.trim()) bits.push('Due Today'); if (p.dueTime) bits.push(L.fmtTime(p.dueTime)); bits.push((p.scope || defScope('tasks')) === 'work' ? 'Work' : 'Personal'); if (p.priority) bits.push({ high: 'High', med: 'Medium', low: 'Low' }[p.priority] + ' priority'); if (p.tags.length) bits.push(p.tags.map(t => '#' + t).join(' '));
      $('#inline-task-preview').textContent = el.value.trim() ? `“${p.title}”${bits.length ? ' · ' + bits.join(' · ') : ''}` : ''; return; }
    if (el.id === 'inline-grocery') { const p = L.parseGrocery(el.value); $('#inline-grocery-preview').textContent = el.value.trim() ? `${p.name}${p.qty ? ' · ' + p.qty + (p.unit ? ' ' + p.unit : '') : ''} · ${p.category}` : ''; return; }
    if (el.id === 'inline-expense') { const p = L.parseExpense(el.value); $('#inline-expense-preview').textContent = el.value.trim() ? `${p.amount ? L.money(p.amount) : 'No amount yet'} · ${p.category} · ${L.relDay(p.date)}${p.note ? ' · ' + p.note : ''}${p.scope ? ' · ' + (p.scope === 'work' ? 'Work' : 'Personal') : ''}` : ''; return; }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (!$('#qa').hidden) closeQA(); else if (!$('#sheet').hidden) closeSheet(); else if (S.shopping) { S.shopping = false; renderShopping(); } }
  });
  $('#scrim').addEventListener('click', () => { if (!$('#qa').hidden) closeQA(); else closeSheet(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (NAV.some(n => n.id === h) && h !== S.view) { S.view = h; render(); } });
  setInterval(() => { if (document.visibilityState === 'visible' && !document.activeElement?.matches('input,textarea,select')) scheduleRender(); }, 60000);
}
async function saveMeal(el) {
  const id = 'w-' + S.mealWeek; const cur = get('meals', id); const doc = cur ? clone(cur) : { id, week: S.mealWeek, days: {}, scope: 'personal' };
  doc.days = doc.days || {}; doc.days[el.dataset.meal] = Object.assign({}, doc.days[el.dataset.meal], { [el.dataset.slot]: el.value.trim() });
  await put('meals', doc);
}
function registerSW() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
function boot() {
  const th = lsGet('theme', 'system'); if (th !== 'system') document.documentElement.setAttribute('data-theme', th);
  const h = location.hash.slice(1); S.view = NAV.some(n => n.id === h) ? h : 'overview';
  wire(); render(); setStatus(); initStore(); registerSW();
}
boot();
