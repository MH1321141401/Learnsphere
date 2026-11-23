'use strict';
/* LearnSphere data layer: everything is stored in this browser (localStorage + IndexedDB for files). */
const Store = (() => {
  const KEY = 'learnsphere_db_v1', TABLES = ['subjects', 'chapters', 'tasks', 'sessions', 'materials', 'notes', 'goals'];
  const ALLOWED = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'md', 'png', 'jpg', 'jpeg'];
  const SPEC = {
    subjects: {name: ['s', 1], color: ['c', 0]},
    chapters: {subject_id: ['i', 1], name: ['s', 1], done: ['b', 0]},
    tasks: {title: ['s', 1], subject_id: ['i', 0], chapter_id: ['i', 0], date: ['d', 1], start_time: ['t', 0], end_time: ['t', 0], priority: ['e:low,medium,high', 0], status: ['e:pending,ongoing,completed', 0]},
    sessions: {subject_id: ['i', 0], seconds: ['p', 1], day: ['d', 0], note: ['s', 0]},
    notes: {subject_id: ['i', 0], title: ['s', 0], body: ['s', 0], pinned: ['b', 0]},
    goals: {kind: ['e:daily,weekly,subject', 1], subject_id: ['i', 0], target_hours: ['f', 1]},
    materials: {subject_id: ['i', 0], title: ['s', 1], description: ['s', 0], tags: ['g', 0]}};
  let D;
  const fail = m => { throw new Error(m); };
  const clone = x => JSON.parse(JSON.stringify(x));
  const now = () => new Date().toISOString().slice(0, 19);
  const ymd = d => d.toLocaleDateString('en-CA');
  const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const validDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && ymd(new Date(v + 'T00:00')) === v;

  function init(src) {
    try { D = src || JSON.parse(localStorage.getItem(KEY)); } catch { D = null; }
    if (!D || typeof D !== 'object') D = {};
    TABLES.forEach(t => D[t] = Array.isArray(D[t]) ? D[t] : []);
    D.activity = D.activity || []; D.settings = D.settings || {name: 'Meahearab'}; D.seq = {};
    TABLES.forEach(t => D.seq[t] = Math.max(0, ...D[t].map(r => r.id || 0)));
  }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch { fail('Browser storage is full. Export a backup and free some space.'); } };
  const nid = t => ++D.seq[t];
  const log = text => { D.activity.unshift({id: Date.now() + Math.random(), text, ts: now()}); D.activity.length = Math.min(D.activity.length, 200); };
  const find = (t, id) => D[t].find(r => r.id === id);

  function clean(t, data, partial) {
    const out = {};
    for (const [k, [ty, req]] of Object.entries(SPEC[t])) {
      const label = k.replace('_', ' '), Label = label[0].toUpperCase() + label.slice(1);
      if (!(k in data)) { if (req && !partial) fail(Label + ' is required.'); continue; }
      let v = data[k];
      if (ty === 's') { v = String(v ?? '').trim(); if (v.length > (k === 'body' ? 100000 : 2000)) fail(Label + ' is too long.'); if (req && !v) fail(Label + ' is required.'); }
      else if (ty === 'g') v = [...new Set(String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))].join(',').slice(0, 300);
      else if (ty === 'i') { if (v === null || v === '' || v === undefined) { if (req) fail(Label + ' is required.'); v = null; } else { v = Number(v); if (!Number.isInteger(v)) fail('Invalid ' + label + '.'); } }
      else if (ty === 'p') { v = Math.trunc(Number(v)); if (!(v >= 1 && v <= 172800)) fail('Duration must be between 1 second and 48 hours.'); }
      else if (ty === 'f') { v = Number(v); if (!(v > 0 && v <= 1000)) fail('Target hours must be between 0 and 1000.'); }
      else if (ty === 'b') v = [true, 1, '1', 'on', 'true'].includes(v) ? 1 : 0;
      else if (ty === 'd') { v = String(v || '').trim(); if (!v && !req) continue; if (!validDate(v)) fail('Invalid date.'); }
      else if (ty === 't') { v = String(v || '').trim(); if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('Invalid time.'); }
      else if (ty === 'c') { v = String(v || '#22d3ee').trim(); if (!/^#[0-9a-fA-F]{6}$/.test(v)) fail('Invalid colour.'); }
      else if (ty.startsWith('e:')) { if (!ty.slice(2).split(',').includes(v)) fail('Invalid ' + label + '.'); }
      out[k] = v;
    }
    if (t === 'tasks' && out.start_time && out.end_time && out.end_time <= out.start_time) fail('End time must be after start time.');
    if (out.subject_id && !find('subjects', out.subject_id)) fail('Invalid subject.');
    if (out.chapter_id && !find('chapters', out.chapter_id)) fail('Invalid chapter.');
    return out;
  }
  const sorters = {
    tasks: (a, b) => (a.date + a.start_time + String(a.id).padStart(9, '0')).localeCompare(b.date + b.start_time + String(b.id).padStart(9, '0')),
    sessions: (a, b) => b.day.localeCompare(a.day) || b.id - a.id, materials: (a, b) => b.id - a.id,
    notes: (a, b) => b.pinned - a.pinned || b.updated.localeCompare(a.updated), subjects: (a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'})};

  /* ---- files (IndexedDB) ---- */
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('learnsphere_files', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => res(r.result); r.onerror = () => rej(new Error('File storage is unavailable in this browser.')); });
  const fileOp = async (mode, fn) => { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('files', mode), rq = fn(tx.objectStore('files')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(new Error('File storage error.')); }); };

  function removeSubjectRefs(id) {
    D.chapters = D.chapters.filter(c => c.subject_id !== id); D.goals = D.goals.filter(g => g.subject_id !== id);
    ['tasks', 'sessions', 'materials', 'notes'].forEach(t => D[t].forEach(r => { if (r.subject_id === id) r.subject_id = null; }));
  }

  function stats(today) {
    if (!validDate(today)) fail('Invalid date.');
    const secs = {}; D.sessions.forEach(s => secs[s.day] = (secs[s.day] || 0) + s.seconds);
    const total = Object.values(secs).reduce((a, b) => a + b, 0), ch = {total: D.chapters.length, done: D.chapters.filter(c => c.done).length};
    const subjects = [...D.subjects].sort(sorters.subjects).map(s => { const c = D.chapters.filter(x => x.subject_id === s.id), done = c.filter(x => x.done).length;
      return {...s, chapters: c.length, done, seconds: D.sessions.filter(x => x.subject_id === s.id).reduce((a, x) => a + x.seconds, 0), pct: c.length ? Math.round(100 * done / c.length) : 0}; });
    const week = [], month = [];
    for (let i = 6; i >= 0; i--) { const d = addDays(today, -i); week.push({label: new Date(d + 'T00:00').toLocaleDateString('en-US', {weekday: 'short'}), seconds: secs[d] || 0}); }
    for (let w = 3; w >= 0; w--) { const st = addDays(today, -(w * 7 + 6)); let s = 0; for (let k = 0; k < 7; k++) s += secs[addDays(st, k)] || 0; month.push({label: new Date(st + 'T00:00').toLocaleDateString('en-US', {month: 'short', day: '2-digit'}), seconds: s}); }
    let streak = 0, day = secs[today] ? today : addDays(today, -1); while (secs[day]) { streak++; day = addDays(day, -1); }
    const sname = id => (find('subjects', id) || {}), wd = (new Date(today + 'T00:00').getDay() + 6) % 7, wk0 = addDays(today, -wd);
    const weekSecs = sid => D.sessions.filter(s => s.day >= wk0 && s.day <= today && (!sid || s.subject_id === sid)).reduce((a, s) => a + s.seconds, 0);
    const goals = D.goals.map(g => { const cur = g.kind === 'daily' ? (secs[today] || 0) : weekSecs(g.kind === 'subject' ? g.subject_id : null);
      return {...g, sname: sname(g.subject_id).name, current: cur, pct: Math.min(100, Math.round(100 * cur / (g.target_hours * 3600)))}; });
    const tasks = {}; D.tasks.forEach(t => tasks[t.status] = (tasks[t.status] || 0) + 1);
    const withS = t => ({...t, sname: sname(t.subject_id).name, scolor: sname(t.subject_id).color});
    const sorted = [...D.tasks].sort(sorters.tasks);
    return {name: D.settings.name, total_seconds: total, today_seconds: secs[today] || 0, streak, chapters: ch, subjects, week, month, goals, tasks,
      today_tasks: sorted.filter(t => t.date === today).map(withS), upcoming: sorted.filter(t => t.status !== 'completed' && t.date > today).slice(0, 6).map(withS),
      overdue: D.tasks.filter(t => t.status !== 'completed' && t.date < today).length, activity: D.activity.slice(0, 40)};
  }

  async function handle(method, url, body) {
    if (!D) init();
    const [path, qs] = url.split('?'), p = path.split('/').filter(Boolean), t = p[1], id = p[2] ? +p[2] : null;
    const out = x => clone(x);
    if (t === 'stats') return stats(new URLSearchParams(qs || '').get('today') || ymd(new Date()));
    if (t === 'settings') { const n = String((body || {}).name || '').trim(); if (n.length < 1 || n.length > 40) fail('Name must be 1-40 characters.'); D.settings.name = n; save(); return {name: n}; }
    if (t === 'reset') { if ((body || {}).confirm !== 'RESET') fail('Type RESET to confirm.'); TABLES.forEach(k => D[k] = []); D.activity = []; D.seq = {}; TABLES.forEach(k => D.seq[k] = 0); save(); await fileOp('readwrite', s => s.clear()); return {ok: true}; }
    if (!SPEC[t]) fail('Not found.');
    if (method === 'GET') return out([...D[t]].sort(sorters[t] || ((a, b) => a.id - b.id)));
    if (t === 'materials' && method === 'POST') {
      const isFd = body instanceof FormData, data = isFd ? Object.fromEntries(body.entries()) : (body || {}), row = clean('materials', data), kind = data.kind || 'link';
      if (!['file', 'video', 'link'].includes(kind)) fail('Invalid type.');
      Object.assign(row, {kind, created: now(), url: '', filename: '', original: ''});
      if (kind === 'file') {
        const f = isFd ? body.get('file') : null; if (!f || !f.name) fail('Choose a file to upload.');
        const ext = (f.name.split('.').pop() || '').toLowerCase(); if (!ALLOWED.includes(ext)) fail('Allowed files: ' + ALLOWED.join(', ') + '.');
        if (f.size > 50 * 1024 * 1024) fail('File is too large (50 MB max).');
        row.filename = crypto.randomUUID() + '.' + ext; row.original = f.name.slice(0, 200); await fileOp('readwrite', s => s.put(f, row.filename));
      } else { const u = String(data.url || '').trim(); if (!/^https?:\/\/\S+$/i.test(u)) fail('Enter a valid link starting with http:// or https://.'); row.url = u; }
      row.id = nid('materials'); D.materials.push(row); log(`Added material "${row.title}"`); save(); return out(row);
    }
    if (t === 'materials' && method === 'DELETE') { const m = find('materials', id); if (m && m.filename) await fileOp('readwrite', s => s.delete(m.filename)); D.materials = D.materials.filter(r => r.id !== id); save(); return {ok: true}; }
    if (method === 'POST') {
      if (id) fail('Not found.'); const row = clean(t, body || {});
      if (t === 'sessions') row.day = row.day || ymd(new Date());
      if (t === 'notes') { row.updated = now(); row.title = row.title || 'Untitled note'; row.body = row.body || ''; row.pinned = row.pinned || 0; }
      if (t === 'goals') { row.created = now(); if (row.kind === 'subject' && !row.subject_id) fail('Choose a subject for a subject goal.'); if (row.kind !== 'subject') row.subject_id = null; }
      if (t === 'subjects') { row.color = row.color || '#22d3ee'; if (D.subjects.some(s => s.name.toLowerCase() === row.name.toLowerCase())) fail('That name already exists.'); }
      if (t === 'tasks') Object.assign(row, {priority: row.priority || 'medium', status: row.status || 'pending', start_time: row.start_time || '', end_time: row.end_time || ''});
      if (t === 'chapters') row.done = row.done || 0;
      row.id = nid(t); D[t].push(row);
      if (t === 'subjects') log(`Added subject "${row.name}"`); else if (t === 'tasks') log(`Planned "${row.title}"`); else if (t === 'chapters') log(`Added chapter "${row.name}"`); else if (t === 'goals') log('Set a new academic goal');
      else if (t === 'sessions') { const s = row.subject_id && find('subjects', row.subject_id); log(`Studied ${Math.max(1, Math.floor(row.seconds / 60))} min` + (s ? ` of ${s.name}` : '')); }
      save(); return out(row);
    }
    const old = find(t, id); if (!old) fail('Not found.');
    if (method === 'PUT') {
      const row = clean(t, body || {}, true); if (t === 'notes') row.updated = now(); if (t === 'goals') delete row.kind;
      if (t === 'subjects' && row.name && D.subjects.some(s => s.id !== id && s.name.toLowerCase() === row.name.toLowerCase())) fail('That name already exists.');
      const prev = {...old}; Object.assign(old, row);
      if (t === 'chapters' && row.done === 1 && !prev.done) log(`Completed chapter "${old.name}"`);
      if (t === 'tasks' && row.status === 'completed' && prev.status !== 'completed') log(`Completed task "${old.title}"`);
      save(); return out(old);
    }
    if (method === 'DELETE') {
      if (t === 'subjects') removeSubjectRefs(id);
      if (t === 'chapters') D.tasks.forEach(k => { if (k.chapter_id === id) k.chapter_id = null; });
      D[t] = D[t].filter(r => r.id !== id); save(); return {ok: true};
    }
    fail('Unsupported request.');
  }
  async function getFile(id) { const m = find('materials', id); const blob = m && m.filename ? await fileOp('readonly', s => s.get(m.filename)) : null; if (!blob) fail('This file is not stored on this device (backups do not include files).'); return {blob, name: m.original}; }
  const exportText = () => JSON.stringify(D, null, 2);
  function importText(text) {
    let x; try { x = JSON.parse(text); } catch { fail('That file is not valid JSON.'); }
    if (!x || typeof x !== 'object' || !TABLES.every(t => Array.isArray(x[t] || []))) fail('That does not look like a LearnSphere backup.');
    init(x); save();
  }
  return {handle, getFile, exportText, importText};
})();
