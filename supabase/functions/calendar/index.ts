// @ts-nocheck
// Daybook calendar feed — Supabase Edge Function named "calendar".
// Serves your planner as a private, read-only calendar (iCalendar) that iPhone Calendar / Outlook can subscribe to.
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor → name it: calendar → paste this whole file → Deploy.
// Then turn OFF "Verify JWT" (sometimes labelled "Enforce JWT verification") for this function, because calendar apps cannot sign in.
// The long random token in the link is what protects your data; you can replace it any time from the app.
import { createClient } from 'npm:@supabase/supabase-js@2';

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

const ICS = (globalThis as any).ICS;
function serviceKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try { const k = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return k.default || Object.values(k)[0]; } catch (_) { return ''; }
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const token = new URL(req.url).searchParams.get('token') || '';
  const notFound = () => new Response('Not found', { status: 404, headers: cors });
  if (!/^[a-z0-9]{24,64}$/i.test(token)) return notFound();
  const sb = createClient(Deno.env.get('SUPABASE_URL'), serviceKey(), { auth: { persistSession: false } });
  const { data: owners, error } = await sb.from('records').select('user_id,data').eq('coll', 'meta').eq('id', 'settings').eq('data->feed->>token', token).limit(2);
  if (error || !owners || owners.length !== 1) return notFound();
  const feed = owners[0].data && owners[0].data.feed;
  if (!feed || feed.enabled === false) return notFound();
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e2 } = await sb.from('records').select('coll,id,data').eq('user_id', owners[0].user_id)
      .in('coll', ['tasks', 'events', 'bills', 'docs', 'projects', 'habits']).range(from, from + 999);
    if (e2) return new Response('Error', { status: 500, headers: cors });
    rows.push(...data); if (data.length < 1000) break;
  }
  return new Response(ICS.buildCalendar(rows, { name: 'Daybook' }), {
    headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Disposition': 'inline; filename="daybook.ics"' }
  });
});
