import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { supabase, checkSupabaseHealth } from './supabase.js';

const API = import.meta.env.VITE_API_URL || '/api';

async function api(path, options = {}, auth = true) {
  const url = path.startsWith('http') ? path : (API.replace(/\/$/, '') + '/' + path.replace(/^\//, ''));
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth && localStorage.token) {
    headers['Authorization'] = `Bearer ${localStorage.token}`;
  }

  const r = await fetch(url, { ...options, headers });
  const isJson = r.headers.get('content-type')?.includes('json');
  const d = isJson ? await r.json() : await r.text();
  if (!r.ok) {
    throw new Error((d && typeof d === 'object' && d.error) ? d.error : (typeof d === 'string' && d ? d : 'Request failed'));
  }
  return d;
}

const msg = e => e instanceof Error ? e.message : String(e || 'Request failed');

const Header = ({ title }) => (
  <header>
    <div>
      <b>GroupForge</b>
      <span>{title}</span>
    </div>
    <div className="header-actions">
      <div className="supa-pill" title="Connected to Supabase Project">
        <span className="supa-dot"></span> Supabase Connected
      </div>
      <button onClick={() => { localStorage.removeItem('token'); location.reload(); }}>Sign out</button>
    </div>
  </header>
);

const Card = ({ title, children }) => <section className="card"><h2>{title}</h2>{children}</section>;
const Notice = ({ text }) => text ? <p className="notice">{text}</p> : null;
const Empty = ({ text }) => <p className="empty">{text}</p>;
const Loading = () => <main><p>Loading…</p></main>;

function Table({ rows, cols }) {
  if (!rows || !rows.length) return <Empty text="No records yet." />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map(c => <th key={c}>{c.replaceAll('_', ' ')}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {cols.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Auth({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({});
  const [note, setNote] = useState('');
  const [supaStatus, setSupaStatus] = useState({ connected: false });

  useEffect(() => {
    checkSupabaseHealth().then(setSupaStatus);
  }, []);

  const input = (name, placeholder, type = 'text', required = false) => (
    <input
      type={type}
      placeholder={placeholder}
      required={required}
      value={form[name] || ''}
      onChange={e => setForm({ ...form, [name]: e.target.value })}
    />
  );

  async function submit(e) {
    e.preventDefault();
    setNote('');
    try {
      if (mode === 'join') {
        await api('/auth/join', { method: 'POST', body: JSON.stringify(form) }, false);
        return setNote('Request sent. Your HOD must approve your role before login.');
      }
      const r = await api(mode === 'hod' ? '/auth/hod-signup' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(form)
      }, false);
      localStorage.token = r.token;
      onLogin(r.user);
    } catch (e) {
      setNote(msg(e));
    }
  }

  return (
    <main className="auth">
      <section>
        <h1>GroupForge</h1>
        <p>Student Project Group Management</p>
        <div className="supa-pill auth-pill" title="Supabase Integration Status">
          <span className="supa-dot"></span>
          Supabase {supaStatus.connected ? 'Active' : 'Connecting…'} (vlyfifpdsmimphchitnm)
        </div>
        <nav>
          {[
            ['login', 'Sign in'],
            ['hod', 'Create workspace'],
            ['join', 'Join workspace']
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? 'active' : ''}
              onClick={() => { setMode(k); setNote(''); }}
            >
              {l}
            </button>
          ))}
        </nav>
        <form onSubmit={submit}>
          {mode === 'hod' && (
            <>
              {input('workspaceName', 'Workspace name', 'text', true)}
              <input
                placeholder="Notion integration token (optional)"
                value={form.notionToken || ''}
                onChange={e => setForm({ ...form, notionToken: e.target.value })}
              />
              <input
                placeholder="Projects database ID (optional)"
                value={form.notionProjectsDbId || ''}
                onChange={e => setForm({ ...form, notionProjectsDbId: e.target.value })}
              />
              <input
                placeholder="Tasks database ID (optional)"
                value={form.notionTasksDbId || ''}
                onChange={e => setForm({ ...form, notionTasksDbId: e.target.value })}
              />
            </>
          )}
          {mode === 'join' && (
            <>
              <input
                placeholder="Workspace invite code"
                required
                value={form.handleCode || ''}
                onChange={e => setForm({ ...form, handleCode: e.target.value })}
              />
              <input
                placeholder="Roll number (students only)"
                value={form.rollNumber || ''}
                onChange={e => setForm({ ...form, rollNumber: e.target.value })}
              />
            </>
          )}
          {input('email', 'Email', 'email', true)}
          {input('password', 'Password', 'password', true)}
          <button className="primary" type="submit">
            {mode === 'login' ? 'Sign in' : mode === 'hod' ? 'Create workspace' : 'Send join request'}
          </button>
          {note && <small>{note}</small>}
        </form>
      </section>
    </main>
  );
}

function HOD() {
  const [d, setD] = useState();
  const [note, setNote] = useState('');
  const [cfg, setCfg] = useState({ totalStudents: '', numGroups: 1, numFaculty: 1, teamSize: 4, segregationBasis: 'CGPA' });

  const load = () => api('/hod/overview')
    .then(x => {
      setD(x);
      if (x.config) {
        setCfg({
          totalStudents: x.config.total_students || '',
          numGroups: x.config.num_groups,
          numFaculty: x.config.num_faculty,
          teamSize: x.config.team_size,
          segregationBasis: x.config.segregation_basis
        });
      }
    })
    .catch(e => setNote(msg(e)));

  useEffect(() => { load(); }, []);

  if (!d) return <Loading />;

  const act = (id, action, role) => api(`/hod/requests/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, role })
  }).then(load).catch(e => setNote(msg(e)));

  const upload = e => {
    if (!e.target.files?.[0]) return;
    const body = new FormData();
    body.append('file', e.target.files[0]);
    api('/hod/import', { method: 'POST', body })
      .then(r => {
        setNote(`${r.imported} roster records imported.`);
        load();
      })
      .catch(e => setNote(msg(e)));
  };

  return (
    <main>
      <Header title="HOD control centre" />
      <Notice text={note} />
      <div className="grid">
        <Card title="Workspace">
          <p className="code">Invite code: {d.workspace.handle_code}</p>
          <p>Share this code with faculty and students.</p>
          <label className="primary file">
            Import class Excel
            <input type="file" accept=".xlsx,.xls" onChange={upload} />
          </label>
        </Card>
        <Card title="Setup & group generation">
          <div className="fields">
            {[
              ['totalStudents', 'Total students'],
              ['numGroups', 'CGPA bands'],
              ['numFaculty', 'Faculty'],
              ['teamSize', 'Team size']
            ].map(([k, l]) => (
              <label key={k}>
                {l}
                <input
                  type="number"
                  min="1"
                  value={cfg[k]}
                  onChange={e => setCfg({ ...cfg, [k]: +e.target.value })}
                />
              </label>
            ))}
          </div>
          <div className="row">
            <button onClick={() => api('/hod/config', { method: 'PUT', body: JSON.stringify(cfg) }).then(() => setNote('Setup saved.')).catch(e => setNote(msg(e)))}>
              Save setup
            </button>
            <button className="primary" onClick={() => api('/hod/generate-groups', { method: 'POST' }).then(r => { setNote(r.message); load(); }).catch(e => setNote(msg(e)))}>
              Generate groups
            </button>
          </div>
        </Card>
      </div>
      <Card title={`Pending join requests (${d.requests.length})`}>
        {d.requests.length ? (
          d.requests.map(r => (
            <div className="row" key={r.id}>
              <span>{r.email}</span>
              <button onClick={() => act(r.id, 'approve', 'FACULTY')}>Approve faculty</button>
              <button onClick={() => act(r.id, 'approve', 'STUDENT')}>Approve student</button>
              <button onClick={() => act(r.id, 'deny')}>Deny</button>
            </div>
          ))
        ) : (
          <Empty text="No pending requests." />
        )}
      </Card>
      <Card title={`Student profiles (${d.students.length})`}>
        <Table rows={d.students} cols={['roll_number', 'name', 'cgpa', 'section', 'is_flagged']} />
      </Card>
      <Card title={`Generated groups (${d.groups.length})`}>
        <Table rows={d.groups} cols={['cgpa_band', 'topic', 'status', 'faculty_email']} />
      </Card>
    </main>
  );
}

function TaskEditor({ group, tasks, reload, notify }) {
  const [title, setTitle] = useState('');
  const [values, setValues] = useState({});

  const task = () => {
    if (!title.trim()) return notify('Enter a task title.');
    api(`/faculty/groups/${group.id}/tasks`, { method: 'POST', body: JSON.stringify({ title }) })
      .then(() => { setTitle(''); reload(); })
      .catch(e => notify(msg(e)));
  };

  const sub = t => {
    const v = values[t.id] || {};
    if (!v.title || !v.studentId) return notify('Enter a subtask and choose a student.');
    api(`/faculty/tasks/${t.id}/subtasks`, {
      method: 'POST',
      body: JSON.stringify({ title: v.title, studentId: v.studentId, dueDate: v.dueDate || null })
    })
      .then(() => { setValues({ ...values, [t.id]: {} }); reload(); })
      .catch(e => notify(msg(e)));
  };

  return (
    <div>
      <div className="row">
        <input value={title} placeholder="New task title" onChange={e => setTitle(e.target.value)} />
        <button onClick={task}>Create task</button>
        {group.notion_project_url && <a href={group.notion_project_url} target="_blank" rel="noreferrer">Open Notion project</a>}
      </div>
      {tasks.map(t => (
        <div className="task" key={t.id}>
          <b>{t.title}</b>
          {t.subtasks?.map(s => (
            <p key={s.id}>{s.title} · {s.status}</p>
          ))}
          <div className="subtask-form">
            <input
              placeholder="Subtask title"
              value={values[t.id]?.title || ''}
              onChange={e => setValues({ ...values, [t.id]: { ...values[t.id], title: e.target.value } })}
            />
            <select
              value={values[t.id]?.studentId || ''}
              onChange={e => setValues({ ...values, [t.id]: { ...values[t.id], studentId: e.target.value } })}
            >
              <option value="">Assign to…</option>
              {group.members.filter(Boolean).map(s => (
                <option key={s.id} value={s.id}>{s.name || s.roll_number}</option>
              ))}
            </select>
            <input
              type="date"
              value={values[t.id]?.dueDate || ''}
              onChange={e => setValues({ ...values, [t.id]: { ...values[t.id], dueDate: e.target.value } })}
            />
            <button onClick={() => sub(t)}>Assign</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Faculty() {
  const [groups, setGroups] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [note, setNote] = useState('');

  const load = () => Promise.all([api('/faculty/groups'), api('/faculty/tasks')])
    .then(([g, t]) => { setGroups(g); setTasks(t); })
    .catch(e => setNote(msg(e)));

  useEffect(() => { load(); }, []);

  const move = (from, to, student) => api(`/faculty/groups/${from}/move`, {
    method: 'POST',
    body: JSON.stringify({ toGroupId: to, studentId: student })
  }).then(load).catch(e => setNote(msg(e)));

  return (
    <main>
      <Header title="Faculty workspace" />
      <Notice text={note} />
      {groups.length === 0 && (
        <Card title="Groups">
          <Empty text="Your HOD has not generated groups yet." />
        </Card>
      )}
      {groups.map(g => (
        <Card title={`${g.cgpa_band} band · ${g.status}`} key={g.id}>
          <input
            defaultValue={g.topic || ''}
            disabled={g.status === 'LOCKED'}
            placeholder="Project topic"
            onBlur={e => api(`/faculty/groups/${g.id}`, { method: 'PATCH', body: JSON.stringify({ topic: e.target.value }) }).then(load).catch(e => setNote(msg(e)))}
          />
          <div className="members">
            {g.members.filter(Boolean).map(s => (
              <div className="member" key={s.id}>
                <span>{s.name || s.roll_number}<small>{s.roll_number}</small></span>
                {g.status === 'FORMING' && (
                  <select defaultValue="" onChange={e => e.target.value && move(g.id, e.target.value, s.id)}>
                    <option value="">Move to…</option>
                    {groups.filter(x => x.id !== g.id && x.status === 'FORMING').map(x => (
                      <option key={x.id} value={x.id}>{x.cgpa_band} band</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          {g.status === 'FORMING' ? (
            <button className="primary" onClick={() => api(`/faculty/groups/${g.id}/lock`, { method: 'POST' }).then(() => { setNote('Group locked.'); load(); }).catch(e => setNote(msg(e)))}>
              Lock group
            </button>
          ) : (
            <TaskEditor group={g} tasks={tasks.filter(t => t.group_id === g.id)} reload={load} notify={setNote} />
          )}
        </Card>
      ))}
    </main>
  );
}

function Student() {
  const [d, setD] = useState();
  const [note, setNote] = useState('');

  const load = () => api('/student/dashboard').then(setD).catch(e => setNote(msg(e)));
  useEffect(() => { load(); }, []);

  if (!d) return <Loading />;

  const download = async () => {
    try {
      const r = await fetch((API.replace(/\/$/, '') + '/export/students.xlsx'), {
        headers: { Authorization: `Bearer ${localStorage.token}` }
      });
      if (!r.ok) throw new Error('Download failed.');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = 'class-register.xlsx';
      a.click();
    } catch (e) {
      setNote(msg(e));
    }
  };

  return (
    <main>
      <Header title="My project" />
      <Notice text={note} />
      <div className="grid">
        <Card title="My profile">
          <p>{d.profile?.name || 'Roster match pending'}</p>
          <p>{d.profile?.roll_number} · CGPA {d.profile?.cgpa || '—'} · Section {d.profile?.section || '—'}</p>
          <button className="primary" onClick={download}>Download class register</button>
        </Card>
        <Card title="My group">
          {d.group ? (
            <>
              <p>{d.group.topic || 'Topic not set yet'}</p>
              <p>{d.group.cgpa_band} band · {d.group.status}</p>
              {d.group.notion_project_url && <a href={d.group.notion_project_url} target="_blank" rel="noreferrer">Open project in Notion</a>}
            </>
          ) : (
            <Empty text="You have not been assigned yet." />
          )}
        </Card>
      </div>
      <Card title="My subtasks">
        {d.subtasks && d.subtasks.length ? (
          d.subtasks.map(s => (
            <div className="row" key={s.id}>
              <span><b>{s.title}</b><small>{s.task_title} · {s.status}</small></span>
              <button
                disabled={s.status === 'DONE'}
                onClick={() => api(`/student/subtasks/${s.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DONE' }) }).then(load).catch(e => setNote(msg(e)))}
              >
                {s.status === 'DONE' ? 'Done' : 'Mark done'}
              </button>
            </div>
          ))
        ) : (
          <Empty text="No subtasks assigned yet." />
        )}
      </Card>
      <Card title="Notifications">
        {d.notifications && d.notifications.length ? (
          d.notifications.map(n => <p key={n.id}>{n.message}</p>)
        ) : (
          <Empty text="No notifications." />
        )}
      </Card>
    </main>
  );
}

function App() {
  const [u, setU] = useState();

  useEffect(() => {
    if (localStorage.token) {
      api('/me')
        .then(setU)
        .catch(() => localStorage.removeItem('token'));
    }
  }, []);

  if (!u) return <Auth onLogin={setU} />;
  if (u.role === 'HOD') return <HOD />;
  if (u.role === 'FACULTY') return <Faculty />;
  return <Student />;
}

createRoot(document.getElementById('root')).render(<App />);
