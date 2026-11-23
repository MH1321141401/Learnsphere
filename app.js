'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ymd = d => d.toLocaleDateString('en-CA');
const today = () => ymd(new Date());
const fh = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`; };
const clock = s => { s = Math.floor(s); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(n => String(n).padStart(2, '0')).join(':'); };
const dlabel = d => new Date(d + 'T00:00').toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});
const S = {stats: null, subjects: [], chapters: [], tasks: [], materials: [], notes: [], sessions: [], goals: []};
const KEYS = ['subjects', 'chapters', 'tasks', 'materials', 'notes', 'sessions', 'goals'];
const sub = id => S.subjects.find(s => s.id == id);
const subTag = id => { const s = sub(id); return s ? `<span class="tag" style="--c:${esc(s.color)}">${esc(s.name)}</span>` : ''; };
const subOpts = (none = '— None —') => [['', none], ...S.subjects.map(s => [s.id, s.name])];

async function api(method, url, body) { return Store.handle(method, url, body); }
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600); }
async function run(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message, true); } }
async function load() {
  const [st, ...r] = await Promise.all([api('GET', '/api/stats?today=' + today()), ...KEYS.map(k => api('GET', '/api/' + k))]);
  S.stats = st; KEYS.forEach((k, i) => S[k] = r[i]);
}
async function refresh() { await load(); route(); }

/* ---------- components ---------- */
const ring = (p, sz = 92, sw = 9) => { const r = (sz - sw) / 2, c = 2 * Math.PI * r, m = sz / 2;
  return `<svg class="ring" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><circle class="rt" cx="${m}" cy="${m}" r="${r}" stroke-width="${sw}"/><circle class="rf" cx="${m}" cy="${m}" r="${r}" stroke-width="${sw}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(p, 100) / 100)}" transform="rotate(-90 ${m} ${m})"/><text x="${m}" y="${m}" style="font-size:${sz / 5}px">${Math.round(p)}%</text></svg>`; };
const bar = p => `<div class="bar"><i style="width:${Math.min(p, 100)}%"></i></div>`;
const empty = (t, btn) => `<div class="empty">${t}${btn ? `<div style="margin-top:10px">${btn}</div>` : ''}</div>`;
const statCard = (l, v, extra = '') => `<div class="glass stat"><div><small>${l}</small><div class="num grad-t">${v}</div></div>${extra}</div>`;
const chip = t => `<button class="chip ${t.status}" data-act="cycle" data-id="${t.id}" title="Change status">${t.status}</button>`;
function taskRow(t, full) {
  const meta = [full ? dlabel(t.date) : '', t.start_time ? t.start_time + (t.end_time ? '–' + t.end_time : '') : ''].filter(Boolean).join(' · ');
  const ch = S.chapters.find(c => c.id == t.chapter_id);
  return `<div class="item ${t.status === 'completed' ? 'done' : ''}"><span class="dot ${t.priority}" title="${t.priority} priority"></span>
  <div class="t"><b>${esc(t.title)}</b><small>${subTag(t.subject_id)}${ch ? esc(ch.name) + ' · ' : ''}${meta}</small></div>${chip(t)}
  <button class="icon" data-act="editTask" data-id="${t.id}" title="Edit">✎</button><button class="icon" data-act="delTask" data-id="${t.id}" title="Delete">✕</button></div>`;
}
const charts = [];
function mkChart(id, cfg) {
  const el = document.getElementById(id); if (!el) return;
  if (typeof Chart === 'undefined') { el.parentNode.innerHTML = empty('Charts need Chart.js (CDN) — check your internet connection.'); return; }
  charts.push(new Chart(el, cfg));
}
function grad(ctx, a = '#00f5a0', b = '#2f7bff', h = 260) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b); return g; }
function chartOpts(extra = {}) {
  return {responsive: true, maintainAspectRatio: false, plugins: {legend: {display: false}, tooltip: {backgroundColor: '#0a1a33', borderColor: 'rgba(60,190,255,.3)', borderWidth: 1}},
    scales: {x: {grid: {display: false}, ticks: {color: '#88a2c4'}}, y: {beginAtZero: true, grid: {color: 'rgba(120,170,230,.08)'}, ticks: {color: '#88a2c4'}, title: {display: true, text: 'hours', color: '#88a2c4'}}}, ...extra};
}
const hrs = a => a.map(x => +(x.seconds / 3600).toFixed(2));
const barChart = (id, data) => mkChart(id, {type: 'bar', data: {labels: data.map(x => x.label), datasets: [{data: hrs(data), borderRadius: 8, backgroundColor: c => grad(c.chart.ctx, '#00f5a0', '#2f7bff', c.chart.height)}]}, options: chartOpts()});
const lineChart = (id, data) => mkChart(id, {type: 'line', data: {labels: data.map(x => x.label), datasets: [{data: hrs(data), tension: .4, fill: true, borderColor: '#00d9f5', pointBackgroundColor: '#00f5a0', backgroundColor: c => { const g = grad(c.chart.ctx, 'rgba(0,245,160,.35)', 'rgba(47,123,255,0)', c.chart.height); return g; }}]}, options: chartOpts()});

/* ---------- forms ---------- */
function fieldHTML(f, v) {
  const val = v ?? f.value ?? ''; const n = `name="${f.name}"`;
  let i;
  if (f.type === 'select') i = `<select ${n}>${f.options.map(o => { const [a, b] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(a)}" ${String(a) === String(val) ? 'selected' : ''}>${esc(b)}</option>`; }).join('')}</select>`;
  else if (f.type === 'textarea') i = `<textarea ${n} ${f.req ? 'required' : ''}>${esc(val)}</textarea>`;
  else i = `<input ${n} type="${f.type || 'text'}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.attrs || ''}>`;
  return `<label ${f.id ? `id="${f.id}"` : ''}>${f.label}${i}</label>`;
}
function openForm(title, fields, vals, onSave, label = 'Save') {
  const m = $('#modal');
  m.innerHTML = `<div class="dlg glass"><h3>${esc(title)}</h3><form>${fields.map(f => fieldHTML(f, vals[f.name])).join('')}<p class="err"></p><div class="row end"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn">${label}</button></div></form></div>`;
  m.classList.add('open');
  const fm = $('form', m); const first = $('input,select,textarea', fm); if (first && first.type !== 'file') first.focus();
  fm.onsubmit = async e => { e.preventDefault(); try { await onSave(new FormData(fm), fm); closeModal(); } catch (x) { $('.err', m).textContent = x.message; } };
  return fm;
}
const closeModal = () => $('#modal').classList.remove('open');
const obj = fd => Object.fromEntries(fd.entries());

/* ---------- pages ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  planner: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  progress: '<path d="M22 7l-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  subjects: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V22h16"/>',
  materials: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  notes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'};
const P = {}, NAV = [['dashboard', 'Dashboard'], ['planner', 'Study Planner'], ['progress', 'My Progress'], ['subjects', 'Subjects & Chapters'], ['materials', 'Study Materials'], ['notes', 'My Notes'], ['timer', 'Study Timer'], ['goals', 'Academic Goals'], ['settings', 'Settings']];
const addSubBtn = '<button class="btn sm" data-act="addSubject">+ Add a subject</button>';

P.dashboard = () => {
  const st = S.stats, h = new Date().getHours(), pct = st.chapters.total ? 100 * st.chapters.done / st.chapters.total : 0;
  const tc = st.tasks.completed || 0, tt = Object.values(st.tasks).reduce((a, b) => a + b, 0);
  const goalsHTML = st.goals.length ? st.goals.slice(0, 4).map(g => `<div style="margin-bottom:12px"><div class="row between"><span>${g.kind === 'daily' ? 'Daily' : g.kind === 'weekly' ? 'Weekly' : esc(g.sname) + ' (week)'}</span><small class="mut">${fh(g.current)} / ${g.target_hours}h</small></div>${bar(g.pct)}</div>`).join('') : empty('No goals yet.', '<a href="#/goals">Set a study target →</a>');
  return `<section class="glass hero"><div><h2>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, <span class="grad-t">${esc(st.name)}</span></h2>
    <p>${new Date().toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})} · ${st.today_tasks.length} task${st.today_tasks.length === 1 ? '' : 's'} scheduled today${st.overdue ? ` · <span style="color:#ff8a9a">${st.overdue} overdue</span>` : ''}</p></div>
    <a class="btn" href="#/timer">▶ Start studying</a></section>
  <div class="grid g4">${statCard('Total study time', fh(st.total_seconds))}${statCard('Overall progress', `${st.chapters.done}/${st.chapters.total}<small style="display:inline"> chapters</small>`, ring(pct, 72, 8))}
  ${statCard('Study streak', `${st.streak} day${st.streak === 1 ? '' : 's'}`)}${statCard('Tasks completed', `${tc}/${tt}`)}</div>
  <div class="grid g21"><div class="glass"><h3>Weekly performance <small class="mut">today: ${fh(st.today_seconds)}</small></h3><div class="chartbox"><canvas id="cWeek"></canvas></div></div>
  <div class="glass"><h3>Today's schedule <a href="#/planner">Planner →</a></h3>${st.today_tasks.length ? st.today_tasks.map(t => taskRow(t)).join('') : empty('Nothing planned for today.', '<button class="btn sm" data-act="addTask">+ Plan a session</button>')}</div></div>
  <div class="grid g3"><div class="glass"><h3>Subject progress</h3>${st.subjects.length ? st.subjects.map(s => `<div style="margin-bottom:14px"><div class="row between"><span>${subTag(s.id)}</span><small class="mut">${s.done}/${s.chapters} · ${fh(s.seconds)}</small></div>${bar(s.pct)}</div>`).join('') : empty('Add subjects to track progress.', addSubBtn)}</div>
  <div class="glass"><h3>Upcoming deadlines</h3>${st.upcoming.length ? st.upcoming.map(t => taskRow(t, true)).join('') : empty('No upcoming tasks.')}</div>
  <div class="glass"><h3>Goals</h3>${goalsHTML}<h3 style="margin-top:18px">Recent activity</h3>${st.activity.length ? st.activity.slice(0, 5).map(a => `<div class="item"><div class="t"><b>${esc(a.text)}</b><small>${new Date(a.ts).toLocaleString()}</small></div></div>`).join('') : empty('Activity appears as you study.')}</div></div>`;
};
P.dashboard.after = () => barChart('cWeek', S.stats.week);

/* planner */
const PL = {view: 'list', filter: '', month: new Date(new Date().getFullYear(), new Date().getMonth(), 1)};
P.planner = () => {
  const list = S.tasks.filter(t => !PL.filter || t.status === PL.filter);
  const byDate = {}; list.forEach(t => (byDate[t.date] ||= []).push(t));
  const listHTML = Object.keys(byDate).sort().map(d => `<div class="glass" style="margin-bottom:14px"><h3>${dlabel(d)}${d === today() ? ' <span class="badge">TODAY</span>' : ''}</h3>${byDate[d].map(t => taskRow(t)).join('')}</div>`).join('') || empty('No tasks yet. Plan your first study session.');
  return `<div class="row between" style="margin-bottom:16px"><div class="tabs"><button data-act="pview" data-v="list" class="${PL.view === 'list' ? 'on' : ''}">List</button><button data-act="pview" data-v="cal" class="${PL.view === 'cal' ? 'on' : ''}">Calendar</button></div>
   <div class="row"><select data-change="pfilter" style="width:auto">${[['', 'All statuses'], ['pending', 'Pending'], ['ongoing', 'Ongoing'], ['completed', 'Completed']].map(([v, l]) => `<option value="${v}" ${PL.filter === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn" data-act="addTask">+ New task</button></div></div>
   ${PL.view === 'list' ? listHTML : calendarHTML(list)}`;
};
function calendarHTML(list) {
  const m = PL.month, first = new Date(m.getFullYear(), m.getMonth(), 1), start = new Date(first); start.setDate(1 - first.getDay());
  let cells = ''; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const k = ymd(d), ev = list.filter(t => t.date === k);
    cells += `<div class="d ${k === today() ? 'today' : ''} ${d.getMonth() !== m.getMonth() ? 'o' : ''} ${ev.length ? 'has' : ''}" data-act="addTask" data-date="${k}"><small>${d.getDate()}</small>${ev.slice(0, 3).map(t => `<span class="ev ${t.status}" data-act="editTask" data-id="${t.id}">${esc(t.title)}</span>`).join('')}${ev.length > 3 ? `<small>+${ev.length - 3} more</small>` : ''}</div>`; }
  return `<div class="glass"><div class="row between" style="margin-bottom:12px"><button class="btn ghost sm" data-act="pmonth" data-d="-1">‹</button><h3 style="margin:0">${m.toLocaleDateString(undefined, {month: 'long', year: 'numeric'})}</h3><button class="btn ghost sm" data-act="pmonth" data-d="1">›</button></div>
   <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="h">${d}</div>`).join('')}${cells}</div></div>`;
}
function taskForm(t = {}) {
  const chs = sid => [['', '— None —'], ...S.chapters.filter(c => c.subject_id == sid).map(c => [c.id, c.name])];
  const fm = openForm(t.id ? 'Edit task' : 'New study task', [
    {name: 'title', label: 'Title', req: 1, attrs: 'maxlength="120"'}, {name: 'subject_id', label: 'Subject', type: 'select', options: subOpts()},
    {name: 'chapter_id', label: 'Chapter', type: 'select', options: chs(t.subject_id)}, {name: 'date', label: 'Date', type: 'date', req: 1},
    {name: 'start_time', label: 'Start time', type: 'time'}, {name: 'end_time', label: 'End time', type: 'time'},
    {name: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high']}, {name: 'status', label: 'Status', type: 'select', options: ['pending', 'ongoing', 'completed']}],
    {priority: 'medium', status: 'pending', date: today(), ...t}, async fd => { const b = obj(fd); await (t.id ? api('PUT', '/api/tasks/' + t.id, b) : api('POST', '/api/tasks', b)); await refresh(); toast('Task saved'); });
  fm.subject_id.onchange = () => { fm.chapter_id.innerHTML = chs(fm.subject_id.value).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(''); };
}

/* progress */
P.progress = () => {
  const st = S.stats;
  return `<div class="row between" style="margin-bottom:16px"><p class="mut">Your academic journey at a glance.</p><button class="btn" data-act="logHours">+ Log study hours</button></div>
  <div class="grid g2"><div class="glass"><h3>This week</h3><div class="chartbox"><canvas id="cW"></canvas></div></div><div class="glass"><h3>Last 4 weeks</h3><div class="chartbox"><canvas id="cM"></canvas></div></div></div>
  <div class="grid auto">${st.subjects.map(s => `<div class="glass row" style="gap:16px">${ring(s.pct, 84)}<div><b>${esc(s.name)}</b><div class="mut">${s.done}/${s.chapters} chapters</div><div class="mut">${fh(s.seconds)} studied</div></div></div>`).join('') || empty('Create subjects and chapters to see progress.', addSubBtn)}</div>
  <div class="grid g2"><div class="glass"><h3>Hours by subject</h3><div class="chartbox"><canvas id="cD"></canvas></div></div>
  <div class="glass"><h3>Academic journey</h3><div class="tl" style="max-height:260px;overflow:auto">${st.activity.map(a => `<div>${esc(a.text)}<small>${new Date(a.ts).toLocaleString()}</small></div>`).join('') || '<span class="mut">Your timeline will build as you work.</span>'}</div></div></div>`;
};
P.progress.after = () => {
  barChart('cW', S.stats.week); lineChart('cM', S.stats.month);
  const s = S.stats.subjects.filter(x => x.seconds);
  if (s.length) mkChart('cD', {type: 'doughnut', data: {labels: s.map(x => x.name), datasets: [{data: hrs(s), backgroundColor: s.map(x => x.color), borderColor: '#050b18', borderWidth: 3}]}, options: {responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: {legend: {position: 'right', labels: {color: '#88a2c4'}}}}});
  else $('#cD')?.parentNode.replaceChildren(Object.assign(document.createElement('div'), {className: 'empty', textContent: 'Study sessions will appear here.'}));
};

/* subjects */
P.subjects = () => `<div class="row end" style="margin-bottom:16px">${addSubBtn}</div><div class="grid auto">${S.stats.subjects.map(s => {
  const chs = S.chapters.filter(c => c.subject_id === s.id);
  return `<div class="glass" style="border-top:3px solid ${esc(s.color)}"><h3><span>${esc(s.name)}</span><span><button class="icon" data-act="editSubject" data-id="${s.id}">✎</button><button class="icon" data-act="delSubject" data-id="${s.id}">✕</button></span></h3>
  <div class="row between"><small class="mut">${s.done}/${s.chapters} chapters · ${fh(s.seconds)}</small><small class="mut">${s.pct}%</small></div>${bar(s.pct)}<div style="margin-top:10px">
  ${chs.map(c => `<div class="item ${c.done ? 'done' : ''}"><input type="checkbox" data-change="togChapter" data-id="${c.id}" ${c.done ? 'checked' : ''}><div class="t"><b>${esc(c.name)}</b></div><button class="icon" data-act="editChapter" data-id="${c.id}">✎</button><button class="icon" data-act="delChapter" data-id="${c.id}">✕</button></div>`).join('') || '<p class="mut">No chapters yet.</p>'}</div>
  <button class="btn ghost sm" style="margin-top:10px" data-act="addChapter" data-id="${s.id}">+ Chapter</button></div>`; }).join('') || empty('No subjects yet.', addSubBtn)}</div>`;

/* materials */
const MF = {q: '', sub: '', kind: ''};
const matGrid = () => {
  const q = MF.q.toLowerCase(), l = S.materials.filter(m => (!MF.sub || m.subject_id == MF.sub) && (!MF.kind || m.kind === MF.kind) && (!q || [m.title, m.description, m.tags, m.original].join(' ').toLowerCase().includes(q)));
  return l.map(m => `<div class="glass"><h3><span>${m.kind === 'file' ? '📄' : m.kind === 'video' ? '🎬' : '🔗'} ${esc(m.title)}</span><span><button class="icon" data-act="editMat" data-id="${m.id}">✎</button><button class="icon" data-act="delMat" data-id="${m.id}">✕</button></span></h3>
  <p class="mut" style="margin-bottom:10px">${esc(m.description) || 'No description'}</p><div style="margin-bottom:10px">${subTag(m.subject_id)}${m.tags ? m.tags.split(',').map(t => `<span class="tag">#${esc(t)}</span>`).join('') : ''}</div>
  ${m.kind === 'file' ? `<button class="btn sm" data-act="openFile" data-id="${m.id}">Open</button> <button class="btn ghost sm" data-act="downloadFile" data-id="${m.id}">Download</button>` : `<a class="btn sm" target="_blank" rel="noopener" href="${esc(m.url)}">Open link</a>`}</div>`).join('') || empty(S.materials.length ? 'No materials match your filters.' : 'Upload a PDF or save a video link to start your library.');
};
P.materials = () => `<div class="row between" style="margin-bottom:16px"><div class="filters" style="margin:0;flex:1"><input data-input="matq" placeholder="Search title, tags, description…" value="${esc(MF.q)}"><select data-change="matsub">${subOpts('All subjects').map(([v, l]) => `<option value="${v}" ${MF.sub == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
  <select data-change="matkind">${[['', 'All types'], ['file', 'Files'], ['video', 'Videos'], ['link', 'Links']].map(([v, l]) => `<option value="${v}" ${MF.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div><button class="btn" data-act="addMat">+ Add material</button></div><div class="grid auto" id="matGrid">${matGrid()}</div>`;

/* notes */
const N = {sel: null, q: ''};
const noteList = () => { const q = N.q.toLowerCase(); const l = S.notes.filter(n => !q || (n.title + n.body).toLowerCase().includes(q));
  return l.map(n => `<div class="note-i ${n.id === N.sel ? 'on' : ''}" data-act="selNote" data-id="${n.id}"><b>${n.pinned ? '📌 ' : ''}${esc(n.title || 'Untitled')}</b><small>${subTag(n.subject_id)} ${esc(n.body.slice(0, 60))}</small></div>`).join('') || '<p class="mut" style="padding:10px">No notes found.</p>'; };
const editorHTML = () => { const n = S.notes.find(x => x.id === N.sel);
  if (!n) return `<div class="empty" style="margin:auto">Select a note or create a new one.</div>`;
  return `<div class="editor"><input class="ttl" id="nTitle" value="${esc(n.title)}" placeholder="Title" maxlength="120"><div class="row"><select id="nSub" style="width:auto">${subOpts().map(([v, l]) => `<option value="${v}" ${n.subject_id == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
  <button class="btn ghost sm" data-act="pinNote">${n.pinned ? 'Unpin' : '📌 Pin'}</button><button class="btn danger sm" data-act="delNote">Delete</button><small class="mut" id="nState">Saved</small></div><textarea id="nBody" placeholder="Start writing… changes save automatically">${esc(n.body)}</textarea></div>`; };
P.notes = () => { if (N.sel && !S.notes.some(n => n.id === N.sel)) N.sel = null;
  return `<div class="split"><div class="glass list"><div class="row" style="margin-bottom:10px"><input data-input="noteq" placeholder="Search notes…" value="${esc(N.q)}" style="flex:1"><button class="btn sm" data-act="newNote">+ New</button></div><div id="noteList">${noteList()}</div></div><div class="glass" id="editor">${editorHTML()}</div></div>`; };
let saveT;
function noteAutosave() {
  const n = S.notes.find(x => x.id === N.sel); if (!n) return; $('#nState').textContent = 'Saving…'; clearTimeout(saveT);
  saveT = setTimeout(async () => { try { const b = {title: $('#nTitle').value.trim() || 'Untitled note', body: $('#nBody').value, subject_id: $('#nSub').value};
    const r = await api('PUT', '/api/notes/' + n.id, b); Object.assign(n, r); $('#nState') && ($('#nState').textContent = 'Saved'); $('#noteList') && ($('#noteList').innerHTML = noteList()); } catch (e) { toast(e.message, true); $('#nState') && ($('#nState').textContent = 'Not saved'); } }, 600);
}

/* timer */
const T = JSON.parse(localStorage.getItem('ls_timer') || '{"acc":0,"at":null,"sub":""}');
const tsave = () => localStorage.setItem('ls_timer', JSON.stringify(T));
const elapsed = () => T.acc + (T.at ? (Date.now() - T.at) / 1000 : 0);
const active = () => T.at || T.acc > 0;
P.timer = () => { const run_ = !!T.at;
  const hist = S.sessions.slice(0, 15);
  return `<div class="grid g21"><div class="glass" style="text-align:center"><h3>Focus session</h3><label style="max-width:320px;margin:0 auto 14px">Subject<select id="tSub" ${active() ? 'disabled' : ''}>${subOpts('General study').map(([v, l]) => `<option value="${v}" ${T.sub == v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
  <div style="position:relative;display:inline-block"><svg class="ring" id="tRing" width="260" height="260" viewBox="0 0 260 260"><circle class="rt" cx="130" cy="130" r="118" stroke-width="10"/><circle class="rf" cx="130" cy="130" r="118" stroke-width="10" stroke-dasharray="741.4" stroke-dashoffset="741.4" transform="rotate(-90 130 130)"/><text class="clock" id="tDisp" x="130" y="130">00:00:00</text></svg></div>
  <div class="row" style="justify-content:center;margin-top:18px">${!active() ? '<button class="btn" data-act="tStart">▶ Start</button>' : `<button class="btn ${run_ ? 'ghost' : ''}" data-act="tToggle">${run_ ? '❚❚ Pause' : '▶ Resume'}</button><button class="btn" data-act="tFinish">■ Finish &amp; save</button><button class="btn danger" data-act="tDiscard">Discard</button>`}</div></div>
  <div class="glass"><h3>Session history <button class="btn ghost sm" data-act="logHours">+ Manual</button></h3>${hist.map(s => `<div class="item"><div class="t"><b>${fh(s.seconds)}</b><small>${subTag(s.subject_id) || 'General'} · ${dlabel(s.day)}${s.note ? ' · ' + esc(s.note) : ''}</small></div><button class="icon" data-act="delSession" data-id="${s.id}">✕</button></div>`).join('') || empty('No sessions recorded yet.')}</div></div>`; };
function tick() {
  const e = elapsed(), pill = $('#tpill');
  pill.hidden = !active() || location.hash === '#/timer'; pill.textContent = (T.at ? '● ' : '❚❚ ') + clock(e);
  const d = $('#tDisp'); if (d) { d.textContent = clock(e); $('#tRing .rf').style.strokeDashoffset = 741.4 * (1 - (e % 3600) / 3600); }
}
setInterval(tick, 500);

/* goals */
P.goals = () => { const gs = S.stats.goals;
  return `<div class="row between" style="margin-bottom:16px"><p class="mut">Daily and weekly targets track study hours. Subject goals count hours this week (Mon–today).</p><button class="btn" data-act="addGoal">+ New goal</button></div>
  <div class="grid auto">${gs.map(g => `<div class="glass row" style="gap:16px">${ring(g.pct, 84)}<div style="flex:1"><b>${g.kind === 'daily' ? 'Daily target' : g.kind === 'weekly' ? 'Weekly target' : esc(g.sname)}</b> ${g.pct >= 100 ? '<span class="badge">ACHIEVED</span>' : ''}<div class="mut">${fh(g.current)} of ${g.target_hours}h</div></div><button class="icon" data-act="delGoal" data-id="${g.id}">✕</button></div>`).join('') || empty('No goals yet. Set a daily or weekly target.')}</div>`; };

P.settings = () => `<div class="grid g2"><div class="glass"><h3>Profile</h3><form data-form="name"><label>Display name<input name="name" value="${esc(S.stats.name)}" maxlength="40" required></label><button class="btn">Save</button></form></div>
  <div class="glass"><h3>Your data</h3><p class="mut" style="margin-bottom:12px">Your data is saved in <b>this browser on this device</b> only. Export a backup regularly (uploaded files are not included in backups).</p><div class="row"><button class="btn ghost" data-act="exportData">Export backup</button><button class="btn ghost" data-act="importData">Import backup</button><button class="btn danger" data-act="reset">Reset all data</button></div></div></div>`;

/* ---------- actions ---------- */
const del = (url, msg) => confirm(msg) && run(async () => { await api('DELETE', url); await refresh(); });
const A = {
  close: closeModal, menu() { $('#side').classList.toggle('open'); $('.scrim').classList.toggle('open'); },
  collapse() { $('#app').classList.toggle('col'); localStorage.setItem('ls_col', $('#app').classList.contains('col') ? 1 : ''); },
  quickTask: () => taskForm(), addTask: d => taskForm(d.date ? {date: d.date} : {}),
  editTask: d => taskForm(S.tasks.find(t => t.id == d.id)),
  delTask: d => del('/api/tasks/' + d.id, 'Delete this task?'),
  cycle: d => { const t = S.tasks.find(x => x.id == d.id) || S.stats.today_tasks.find(x => x.id == d.id) || S.stats.upcoming.find(x => x.id == d.id); const nx = {pending: 'ongoing', ongoing: 'completed', completed: 'pending'}[t.status]; return run(async () => { await api('PUT', '/api/tasks/' + t.id, {status: nx}); await refresh(); }); },
  pview(d) { PL.view = d.v; route(); }, pmonth(d) { PL.month = new Date(PL.month.getFullYear(), PL.month.getMonth() + +d.d, 1); route(); },
  addSubject: () => openForm('New subject', [{name: 'name', label: 'Name', req: 1, attrs: 'maxlength="60"'}, {name: 'color', label: 'Colour', type: 'color'}], {color: '#00d9f5'}, async fd => { await api('POST', '/api/subjects', obj(fd)); await refresh(); toast('Subject added'); }),
  editSubject(d) { const s = sub(d.id); openForm('Edit subject', [{name: 'name', label: 'Name', req: 1}, {name: 'color', label: 'Colour', type: 'color'}], s, async fd => { await api('PUT', '/api/subjects/' + s.id, obj(fd)); await refresh(); }); },
  delSubject: d => del('/api/subjects/' + d.id, 'Delete this subject and its chapters? Study history is kept.'),
  addChapter: d => openForm('New chapter', [{name: 'name', label: 'Chapter name', req: 1}], {}, async fd => { await api('POST', '/api/chapters', {...obj(fd), subject_id: d.id}); await refresh(); }),
  editChapter(d) { const c = S.chapters.find(x => x.id == d.id); openForm('Rename chapter', [{name: 'name', label: 'Chapter name', req: 1}], c, async fd => { await api('PUT', '/api/chapters/' + c.id, obj(fd)); await refresh(); }); },
  delChapter: d => del('/api/chapters/' + d.id, 'Delete this chapter?'),
  addMat() { const fm = openForm('Add study material', [{name: 'title', label: 'Title', req: 1}, {name: 'kind', label: 'Type', type: 'select', options: [['file', 'Upload file (PDF, docs, images)'], ['video', 'Video link'], ['link', 'Web link']]},
    {name: 'file', label: 'File (max 50 MB)', type: 'file', id: 'fFile', attrs: 'accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg"'}, {name: 'url', label: 'URL', type: 'url', id: 'fUrl', attrs: 'placeholder="https://"'},
    {name: 'subject_id', label: 'Subject', type: 'select', options: subOpts()}, {name: 'description', label: 'Description', type: 'textarea'}, {name: 'tags', label: 'Tags (comma separated)'}], {kind: 'file'},
    async fd => { await api('POST', '/api/materials', fd); await refresh(); toast('Material saved'); });
    const sync = () => { const f = fm.kind.value === 'file'; $('#fFile').style.display = f ? '' : 'none'; $('#fUrl').style.display = f ? 'none' : ''; }; fm.kind.onchange = sync; sync(); },
  editMat(d) { const m = S.materials.find(x => x.id == d.id); openForm('Edit material', [{name: 'title', label: 'Title', req: 1}, {name: 'subject_id', label: 'Subject', type: 'select', options: subOpts()}, {name: 'description', label: 'Description', type: 'textarea'}, {name: 'tags', label: 'Tags'}], m, async fd => { await api('PUT', '/api/materials/' + m.id, obj(fd)); await refresh(); }); },
  delMat: d => del('/api/materials/' + d.id, 'Delete this material (and its file)?'),
  newNote: () => run(async () => { const n = await api('POST', '/api/notes', {title: 'Untitled note', body: ''}); await load(); N.sel = n.id; route(); $('#nTitle')?.select(); }),
  selNote(d) { N.sel = +d.id; $('#editor').innerHTML = editorHTML(); $('#noteList').innerHTML = noteList(); },
  pinNote: () => run(async () => { const n = S.notes.find(x => x.id === N.sel); await api('PUT', '/api/notes/' + n.id, {pinned: n.pinned ? 0 : 1}); await load(); route(); }),
  delNote: () => confirm('Delete this note?') && run(async () => { await api('DELETE', '/api/notes/' + N.sel); N.sel = null; await refresh(); }),
  tStart() { T.sub = $('#tSub').value; T.acc = 0; T.at = Date.now(); tsave(); route(); },
  tToggle() { if (T.at) { T.acc = elapsed(); T.at = null; } else T.at = Date.now(); tsave(); route(); },
  tDiscard() { if (confirm('Discard this session?')) { T.acc = 0; T.at = null; tsave(); route(); } },
  tFinish: () => { const s = Math.round(elapsed()); if (s < 1) return toast('Nothing to save yet', true); return run(async () => { await api('POST', '/api/sessions', {seconds: s, subject_id: T.sub, day: today()}); T.acc = 0; T.at = null; tsave(); await refresh(); }, 'Session saved — ' + fh(s)); },
  delSession: d => del('/api/sessions/' + d.id, 'Delete this session?'),
  logHours: () => openForm('Log study time', [{name: 'subject_id', label: 'Subject', type: 'select', options: subOpts('General study')}, {name: 'hours', label: 'Hours', type: 'number', attrs: 'min="0" max="24" step="1"', value: 0}, {name: 'minutes', label: 'Minutes', type: 'number', attrs: 'min="0" max="59" step="1"', value: 30}, {name: 'day', label: 'Date', type: 'date', req: 1, value: today()}, {name: 'note', label: 'Note'}], {}, async fd => { const b = obj(fd); await api('POST', '/api/sessions', {subject_id: b.subject_id, day: b.day, note: b.note, seconds: (+b.hours || 0) * 3600 + (+b.minutes || 0) * 60}); await refresh(); toast('Time logged'); }),
  addGoal() { const fm = openForm('New goal', [{name: 'kind', label: 'Type', type: 'select', options: [['daily', 'Daily study target'], ['weekly', 'Weekly study target'], ['subject', 'Subject goal (per week)']]}, {name: 'subject_id', label: 'Subject', type: 'select', options: subOpts(), id: 'gSub'}, {name: 'target_hours', label: 'Target hours', type: 'number', req: 1, attrs: 'min="0.25" max="1000" step="0.25"'}], {}, async fd => { await api('POST', '/api/goals', obj(fd)); await refresh(); toast('Goal created'); });
    const sync = () => $('#gSub').style.display = fm.kind.value === 'subject' ? '' : 'none'; fm.kind.onchange = sync; sync(); },
  delGoal: d => del('/api/goals/' + d.id, 'Delete this goal?'),
  openFile: d => run(async () => { const f = await Store.getFile(+d.id); window.open(URL.createObjectURL(f.blob), '_blank'); }),
  downloadFile: d => run(async () => { const f = await Store.getFile(+d.id); const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(f.blob), download: f.name}); a.click(); }),
  exportData() { const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(new Blob([Store.exportText()], {type: 'application/json'})), download: 'learnsphere-backup-' + today() + '.json'}); a.click(); toast('Backup downloaded'); },
  importData() { const i = Object.assign(document.createElement('input'), {type: 'file', accept: '.json,application/json'}); i.onchange = () => i.files[0] && confirm('Replace ALL current data with this backup?') && run(async () => { Store.importText(await i.files[0].text()); N.sel = null; await refresh(); }, 'Backup imported'); i.click(); },
  reset() { const v = prompt('This permanently deletes ALL subjects, notes, files and history.\nType RESET to confirm:'); if (v) run(async () => { await api('POST', '/api/reset', {confirm: v}); N.sel = null; await refresh(); }, 'All data cleared'); }
};
const CHANGE = {
  pfilter: e => { PL.filter = e.value; route(); },
  matsub: e => { MF.sub = e.value; $('#matGrid').innerHTML = matGrid(); }, matkind: e => { MF.kind = e.value; $('#matGrid').innerHTML = matGrid(); },
  togChapter: e => run(async () => { await api('PUT', '/api/chapters/' + e.dataset.id, {done: e.checked ? 1 : 0}); await refresh(); })
};
const INPUT = {matq: e => { MF.q = e.value; $('#matGrid').innerHTML = matGrid(); }, noteq: e => { N.q = e.value; $('#noteList').innerHTML = noteList(); }};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation(); if (e.target.closest('[data-act="editTask"]') && b.dataset.act === 'addTask') return A.editTask(e.target.closest('[data-act="editTask"]').dataset); A[b.dataset.act]?.(b.dataset, b); });
document.addEventListener('change', e => { const a = e.target.dataset.change; if (a) CHANGE[a](e.target); });
document.addEventListener('input', e => { const a = e.target.dataset.input; if (a) return INPUT[a](e.target); if (['nTitle', 'nBody', 'nSub'].includes(e.target.id)) noteAutosave(); });
document.addEventListener('submit', e => { if (e.target.dataset.form === 'name') { e.preventDefault(); run(async () => { await api('PUT', '/api/settings', obj(new FormData(e.target))); await refresh(); }, 'Saved'); } });
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- router ---------- */
$('#nav').innerHTML = NAV.map(([id, l]) => `<a href="#/${id}" data-id="${id}"><svg viewBox="0 0 24 24">${ICONS[id]}</svg><span>${l}</span></a>`).join('');
if (localStorage.getItem('ls_col')) $('#app').classList.add('col');
function route() {
  const id = P[location.hash.slice(2)] ? location.hash.slice(2) : 'dashboard';
  charts.splice(0).forEach(c => c.destroy());
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.id === id));
  $('#ptitle').textContent = NAV.find(n => n[0] === id)[1];
  $('#side').classList.remove('open'); $('.scrim').classList.remove('open');
  if (!S.stats) return;
  $('#view').innerHTML = P[id](); P[id].after?.(); tick();
}
window.addEventListener('hashchange', route);
load().then(route).catch(e => { $('#view').innerHTML = empty('Could not load your data: ' + esc(e.message)); });

navigator.storage?.persist?.();
