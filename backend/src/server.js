import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import XLSX from 'xlsx';
import crypto from 'node:crypto';
import cron from 'node-cron';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { Client as Notion } from '@notionhq/client';
import { supabase, checkSupabaseConnection } from './supabase.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const secret = process.env.JWT_SECRET || 'development-secret-change-me';

const connectionString = process.env.DATABASE_URL;
const embedded = !connectionString;

let local = null;
let db = null;

if (embedded) {
  const pgliteDir = process.env.PGLITE_DATA_DIR || '.pglite';
  try {
    if (fs.existsSync(pgliteDir + '/postmaster.pid')) {
      try { fs.unlinkSync(pgliteDir + '/postmaster.pid'); } catch {}
    }
    local = new PGlite(pgliteDir);
    await local.query('SELECT 1');
  } catch (err) {
    console.warn(`Persistent PGlite storage unavailable (${err.message}). Using in-memory PGlite database.`);
    local = new PGlite();
  }
  db = {
    query: (text, params = []) => local.query(text, params),
    connect: async () => ({
      query: (text, params = []) => local.query(text, params),
      release: () => {}
    })
  };
} else {
  const isRemoteOrSsl = connectionString.includes('supabase') || 
                        connectionString.includes('sslmode=require') || 
                        process.env.DB_SSL === 'true';
  db = new pg.Pool({
    connectionString,
    ssl: isRemoteOrSsl ? { rejectUnauthorized: false } : undefined
  });
}

async function ensureSchema() {
  const exists = await db.query("SELECT to_regclass('public.workspaces') AS table_name");
  if (exists.rows[0]?.table_name) return;
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch {}
  const sql = fs.readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8')
    .replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
  if (embedded) {
    await local.exec(sql);
  } else {
    await db.query(sql);
  }
}

await ensureSchema();
console.log(embedded ? 'Using embedded PGlite database.' : 'Using PostgreSQL from DATABASE_URL.');

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  credentials: true
}));
app.use(express.json());

const q = (text, params = []) => db.query(text, params);
const token = u => jwt.sign({ id: u.id, role: u.role, workspaceId: u.workspace_id }, secret, { expiresIn: '8h' });

const auth = (roles = []) => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), secret);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
};

const handle = () => crypto.randomBytes(4).toString('hex').toUpperCase();

function encrypt(value) {
  if (!value) return null;
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  return [iv.toString('base64'), cipher.update(value, 'utf8', 'base64') + cipher.final('base64'), cipher.getAuthTag().toString('base64')].join('.');
}

function decrypt(value) {
  if (!value) return null;
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || !value.includes('.')) return value;
  const [iv, data, tag] = value.split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return d.update(data, 'base64', 'utf8') + d.final('utf8');
}

async function workspace(id) {
  return (await q('SELECT * FROM workspaces WHERE id=$1', [id])).rows[0];
}

async function notify(user, type, message) {
  await q('INSERT INTO notifications(user_id,type,message) VALUES($1,$2,$3)', [user, type, message]);
}

async function ownGroup(req, groupId) {
  const r = await q('SELECT g.* FROM groups g JOIN faculty f ON f.id=g.faculty_id WHERE g.id=$1 AND f.user_id=$2', [groupId, req.user.id]);
  return r.rows[0];
}

async function notionFor(ws) {
  if (!ws?.notion_token_encrypted) return null;
  return new Notion({ auth: decrypt(ws.notion_token_encrypted) });
}

async function provisionProject(group) {
  const ws = await workspace(group.workspace_id);
  const notion = await notionFor(ws);
  if (!notion || !ws.notion_projects_db_id) return;
  const page = await notion.pages.create({
    parent: { database_id: ws.notion_projects_db_id },
    properties: { Name: { title: [{ text: { content: group.topic || 'Untitled project' } }] }, Status: { select: { name: 'Not Started' } } }
  });
  await q('UPDATE groups SET notion_project_page_id=$1,notion_project_url=$2 WHERE id=$3', [page.id, page.url, group.id]);
}

async function syncSubtask(subtask, project) {
  const ws = await workspace(project.workspace_id);
  const notion = await notionFor(ws);
  if (!notion || !ws.notion_tasks_db_id || !project.notion_project_page_id) return;
  const p = {
    Title: { title: [{ text: { content: subtask.title } }] },
    Assignee: { rich_text: [{ text: { content: subtask.student_name } }] },
    Status: { select: { name: subtask.status === 'DONE' ? 'Done' : subtask.status === 'IN_PROGRESS' ? 'In Progress' : 'To Do' } },
    Project: { relation: [{ id: project.notion_project_page_id }] }
  };
  if (subtask.due_date) p['Due Date'] = { date: { start: subtask.due_date } };
  const page = await notion.pages.create({ parent: { database_id: ws.notion_tasks_db_id }, properties: p });
  await q('UPDATE subtasks SET notion_subtask_id=$1 WHERE id=$2', [page.id, subtask.id]);
}

// Health and Supabase status endpoints
app.get('/api/health', async (req, res) => {
  const supa = await checkSupabaseConnection();
  res.json({
    status: 'ok',
    mode: embedded ? 'embedded-pglite' : 'postgresql',
    supabase: supa,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/supabase/status', async (req, res) => {
  const supa = await checkSupabaseConnection();
  res.json(supa);
});

// Authentication endpoints
app.post('/api/auth/hod-signup', async (req, res) => {
  try {
    const { email, password, workspaceName, notionToken, notionParentPageId, notionProjectsDbId, notionTasksDbId } = req.body;
    if (!email || !password || !workspaceName) return res.status(400).json({ error: 'email, password and workspaceName required' });
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      const u = (await c.query('INSERT INTO users(email,password_hash,role,status) VALUES($1,$2,$3,$4) RETURNING *', [email, bcrypt.hashSync(password, 12), 'HOD', 'APPROVED'])).rows[0];
      let code = handle();
      while ((await c.query('SELECT 1 FROM workspaces WHERE handle_code=$1', [code])).rowCount) code = handle();
      const ws = (await c.query('INSERT INTO workspaces(name,handle_code,hod_user_id,notion_token_encrypted,notion_parent_page_id,notion_projects_db_id,notion_tasks_db_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [workspaceName, code, u.id, encrypt(notionToken), notionParentPageId, notionProjectsDbId, notionTasksDbId])).rows[0];
      await c.query('UPDATE users SET workspace_id=$1 WHERE id=$2', [ws.id, u.id]);
      await c.query('COMMIT');
      u.workspace_id = ws.id;
      res.json({ token: token(u), user: u, workspace: ws });
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  } catch (e) {
    res.status(400).json({ error: e.message.includes('unique') ? 'Email already registered' : e.message });
  }
});

app.post('/api/auth/join', async (req, res) => {
  try {
    const { email, password, handleCode, rollNumber } = req.body;
    const ws = (await q('SELECT * FROM workspaces WHERE handle_code=$1', [String(handleCode).toUpperCase()])).rows[0];
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    const user = (await q('INSERT INTO users(email,password_hash,workspace_id) VALUES($1,$2,$3) RETURNING *', [email, bcrypt.hashSync(password, 12), ws.id])).rows[0];
    if (rollNumber) {
      const match = (await q('SELECT * FROM master_student_records WHERE workspace_id=$1 AND roll_number=$2', [ws.id, rollNumber])).rows[0];
      await q('INSERT INTO student_profiles(user_id,roll_number,name,cgpa,section,matched_master_record_id,is_flagged) VALUES($1,$2,$3,$4,$5,$6,$7)', [user.id, rollNumber, match?.name || null, match?.cgpa || null, match?.section || null, match?.id || null, !match]);
      if (!match) await notify(ws.hod_user_id, 'ROLL_NUMBER_MISMATCH', `Roll number ${rollNumber} did not match the uploaded register.`);
    }
    res.status(201).json({ message: 'Join request sent. Your HOD must approve and assign a role.' });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('unique') ? 'Email already registered' : e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const u = (await q('SELECT * FROM users WHERE email=$1', [req.body.email])).rows[0];
  if (!u || !bcrypt.compareSync(req.body.password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (u.status !== 'APPROVED') return res.status(403).json({ error: `Request is ${u.status.toLowerCase()}` });
  res.json({ token: token(u), user: u });
});

app.get('/api/me', auth(), async (req, res) => {
  const data = (await q('SELECT u.id,u.email,u.role,u.status,w.name workspace_name,w.handle_code FROM users u LEFT JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=$1', [req.user.id])).rows[0];
  res.json(data);
});

// HOD endpoints
app.get('/api/hod/overview', auth(['HOD']), async (req, res) => {
  const w = req.user.workspaceId;
  const [requests, students, faculty, groups, config, flags, ws] = await Promise.all([
    q('SELECT id,email,created_at FROM users WHERE workspace_id=$1 AND status=$2', [w, 'PENDING']),
    q('SELECT sp.*,u.email FROM student_profiles sp JOIN users u ON u.id=sp.user_id WHERE u.workspace_id=$1', [w]),
    q('SELECT f.id,u.email FROM faculty f JOIN users u ON u.id=f.user_id WHERE f.workspace_id=$1', [w]),
    q('SELECT g.*,u.email faculty_email FROM groups g JOIN faculty f ON f.id=g.faculty_id JOIN users u ON u.id=f.user_id WHERE g.workspace_id=$1', [w]),
    q('SELECT * FROM setup_configs WHERE workspace_id=$1', [w]),
    q('SELECT * FROM notifications WHERE user_id=$1 AND type=$2 ORDER BY created_at DESC', [req.user.id, 'ROLL_NUMBER_MISMATCH']),
    workspace(w)
  ]);
  res.json({ workspace: ws, requests: requests.rows, students: students.rows, faculty: faculty.rows, groups: groups.rows, config: config.rows[0], flags: flags.rows });
});

app.patch('/api/hod/requests/:id', auth(['HOD']), async (req, res) => {
  const { action, role } = req.body;
  const target = (await q('SELECT * FROM users WHERE id=$1 AND workspace_id=$2 AND status=$3', [req.params.id, req.user.workspaceId, 'PENDING'])).rows[0];
  if (!target) return res.status(404).json({ error: 'Pending request not found' });
  if (action === 'deny') {
    await q("UPDATE users SET status='DENIED' WHERE id=$1", [target.id]);
  } else if (['FACULTY', 'STUDENT'].includes(role)) {
    await q("UPDATE users SET status='APPROVED',role=$1 WHERE id=$2", [role, target.id]);
    if (role === 'FACULTY') {
      await q('INSERT INTO faculty(user_id,workspace_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING', [target.id, req.user.workspaceId]);
    }
  } else {
    return res.status(400).json({ error: 'Choose Faculty or Student' });
  }
  res.json({ ok: true });
});

app.post('/api/hod/import', auth(['HOD']), upload.single('file'), async (req, res) => {
  try {
    const book = XLSX.read(req.file.buffer);
    const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: null });
    let count = 0;
    for (const row of rows) {
      const roll = row.roll_number ?? row.RollNumber ?? row['Roll Number'];
      if (!roll) continue;
      await q('INSERT INTO master_student_records(workspace_id,roll_number,name,cgpa,section,uploaded_from_file) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,roll_number) DO UPDATE SET name=EXCLUDED.name,cgpa=EXCLUDED.cgpa,section=EXCLUDED.section', [req.user.workspaceId, String(roll), (row.name ?? row.Name ?? ''), (row.cgpa ?? row.CGPA ?? null), (row.section ?? row.Section ?? null), req.file.originalname]);
      count++;
    }
    res.json({ imported: count });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/hod/config', auth(['HOD']), async (req, res) => {
  const { totalStudents, numGroups, teamSize, numFaculty, segregationBasis = 'CGPA' } = req.body;
  const r = await q('INSERT INTO setup_configs(workspace_id,total_students,num_groups,team_size,num_faculty,segregation_basis) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id) DO UPDATE SET total_students=$2,num_groups=$3,team_size=$4,num_faculty=$5,segregation_basis=$6 RETURNING *', [req.user.workspaceId, totalStudents, numGroups, teamSize, numFaculty, segregationBasis]);
  res.json(r.rows[0]);
});

app.post('/api/hod/generate-groups', auth(['HOD']), async (req, res) => {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const ws = req.user.workspaceId;
    const config = (await c.query('SELECT * FROM setup_configs WHERE workspace_id=$1', [ws])).rows[0];
    const fac = (await c.query('SELECT * FROM faculty WHERE workspace_id=$1 ORDER BY id', [ws])).rows;
    if (!config || config.num_groups !== config.num_faculty || fac.length !== config.num_faculty) {
      throw Error('Setup requires num_groups = num_faculty and that many approved faculty.');
    }
    const locked = (await c.query("SELECT 1 FROM groups WHERE workspace_id=$1 AND status='LOCKED'", [ws])).rowCount;
    if (locked) throw Error('Cannot regenerate while locked groups exist.');
    await c.query("DELETE FROM groups WHERE workspace_id=$1 AND status='FORMING'", [ws]);
    const students = (await c.query("SELECT sp.* FROM student_profiles sp JOIN users u ON u.id=sp.user_id WHERE u.workspace_id=$1 AND u.status='APPROVED' AND u.role='STUDENT' ORDER BY sp.cgpa DESC NULLS LAST", [ws])).rows;
    const bands = Array.from({ length: config.num_groups }, () => []);
    students.forEach((s, i) => bands[i % config.num_groups].push(s));
    for (let i = 0; i < bands.length; i++) {
      bands[i].sort(() => Math.random() - .5);
      for (let n = 0; n < bands[i].length; n += config.team_size) {
        const g = (await c.query("INSERT INTO groups(workspace_id,faculty_id,cgpa_band) VALUES($1,$2,$3) RETURNING id", [ws, fac[i].id, String.fromCharCode(65 + i)])).rows[0];
        for (const s of bands[i].slice(n, n + config.team_size)) {
          await c.query('INSERT INTO group_members(group_id,student_id) VALUES($1,$2)', [g.id, s.id]);
        }
      }
    }
    await c.query('COMMIT');
    res.json({ message: 'Groups generated', students: students.length });
  } catch (e) {
    await c.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    c.release();
  }
});

app.get('/api/export/students.xlsx', auth(), async (req, res) => {
  const rows = (await q('SELECT roll_number,name,cgpa,section FROM master_student_records WHERE workspace_id=$1 ORDER BY roll_number', [req.user.workspaceId])).rows;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Students');
  res.setHeader('Content-Disposition', 'attachment; filename=class-register.xlsx');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
});

// Faculty endpoints
app.get('/api/faculty/groups', auth(['FACULTY']), async (req, res) => {
  const r = await q("SELECT g.*,json_agg(json_build_object('id',sp.id,'name',sp.name,'roll_number',sp.roll_number)) FILTER (WHERE sp.id IS NOT NULL) members FROM groups g JOIN faculty f ON f.id=g.faculty_id LEFT JOIN group_members gm ON gm.group_id=g.id LEFT JOIN student_profiles sp ON sp.id=gm.student_id WHERE f.user_id=$1 GROUP BY g.id ORDER BY g.created_at", [req.user.id]);
  res.json(r.rows.map(g => ({ ...g, members: g.members || [] })));
});

app.get('/api/faculty/tasks', auth(['FACULTY']), async (req, res) => {
  const r = await q("SELECT t.*,g.topic,g.id group_id,json_agg(json_build_object('id',s.id,'title',s.title,'status',s.status,'assigned_student_id',s.assigned_student_id,'due_date',s.due_date)) FILTER (WHERE s.id IS NOT NULL) subtasks FROM tasks t JOIN groups g ON g.id=t.group_id JOIN faculty f ON f.id=g.faculty_id LEFT JOIN subtasks s ON s.task_id=t.id WHERE f.user_id=$1 GROUP BY t.id,g.id ORDER BY t.created_at DESC", [req.user.id]);
  res.json(r.rows.map(t => ({ ...t, subtasks: t.subtasks || [] })));
});

app.patch('/api/faculty/groups/:id', auth(['FACULTY']), async (req, res) => {
  const g = await ownGroup(req, req.params.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (g.status === 'LOCKED') return res.status(409).json({ error: 'Locked groups are immutable' });
  const r = await q('UPDATE groups SET topic=$1 WHERE id=$2 RETURNING *', [req.body.topic, g.id]);
  res.json(r.rows[0]);
});

app.post('/api/faculty/groups/:id/move', auth(['FACULTY']), async (req, res) => {
  const from = await ownGroup(req, req.params.id);
  const to = await ownGroup(req, req.body.toGroupId);
  if (!from || !to) return res.status(403).json({ error: 'Both groups must be yours' });
  if (from.status === 'LOCKED' || to.status === 'LOCKED') return res.status(409).json({ error: 'Locked groups are immutable' });
  await q('UPDATE group_members SET group_id=$1 WHERE group_id=$2 AND student_id=$3', [to.id, from.id, req.body.studentId]);
  res.json({ ok: true });
});

app.post('/api/faculty/groups/:id/lock', auth(['FACULTY']), async (req, res) => {
  const g = await ownGroup(req, req.params.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (!g.topic) return res.status(400).json({ error: 'Set a topic before locking' });
  if (g.status === 'LOCKED') return res.json(g);
  await q("UPDATE groups SET status='LOCKED' WHERE id=$1", [g.id]);
  try { await provisionProject(g); } catch (e) { console.error('Notion project provisioning:', e.message); }
  res.json({ ok: true });
});

app.post('/api/faculty/groups/:id/tasks', auth(['FACULTY']), async (req, res) => {
  const g = await ownGroup(req, req.params.id);
  if (!g || g.status !== 'LOCKED') return res.status(409).json({ error: 'Tasks require one of your locked groups' });
  const facId = (await q('SELECT id FROM faculty WHERE user_id=$1', [req.user.id])).rows[0]?.id;
  const t = (await q('INSERT INTO tasks(group_id,title,description,created_by_faculty_id) VALUES($1,$2,$3,$4) RETURNING *', [g.id, req.body.title, req.body.description, facId])).rows[0];
  res.json(t);
});

app.post('/api/faculty/tasks/:id/subtasks', auth(['FACULTY']), async (req, res) => {
  try {
    const r = (await q('SELECT t.id AS task_id,g.*,sp.name student_name,sp.user_id student_user FROM tasks t JOIN groups g ON g.id=t.group_id JOIN faculty f ON f.id=g.faculty_id JOIN student_profiles sp ON sp.id=$2 WHERE t.id=$1 AND f.user_id=$3 AND EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=g.id AND gm.student_id=sp.id)', [req.params.id, req.body.studentId, req.user.id])).rows[0];
    if (!r) return res.status(403).json({ error: 'Student must be in your group' });
    const s = (await q('INSERT INTO subtasks(task_id,title,assigned_student_id,due_date) VALUES($1,$2,$3,$4) RETURNING *', [r.task_id, req.body.title, req.body.studentId, req.body.dueDate || null])).rows[0];
    await notify(r.student_user, 'SUBTASK_ASSIGNED', `You were assigned: ${s.title}`);
    try { await syncSubtask({ ...s, student_name: r.student_name }, r); } catch (e) { console.error('Notion task sync:', e.message); }
    res.json(s);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Student endpoints
app.get('/api/student/dashboard', auth(['STUDENT']), async (req, res) => {
  const p = (await q('SELECT * FROM student_profiles WHERE user_id=$1', [req.user.id])).rows[0];
  const group = p ? (await q('SELECT g.* FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE gm.student_id=$1', [p.id])).rows[0] : null;
  const subtasks = p ? (await q('SELECT s.*,t.title task_title FROM subtasks s JOIN tasks t ON t.id=s.task_id WHERE s.assigned_student_id=$1 ORDER BY s.due_date', [p.id])).rows : [];
  const notes = (await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id])).rows;
  res.json({ profile: p, group, subtasks, notifications: notes });
});

app.patch('/api/student/subtasks/:id', auth(['STUDENT']), async (req, res) => {
  const s = (await q('SELECT s.*,sp.user_id,t.group_id,g.workspace_id FROM subtasks s JOIN student_profiles sp ON sp.id=s.assigned_student_id JOIN tasks t ON t.id=s.task_id JOIN groups g ON g.id=t.group_id WHERE s.id=$1', [req.params.id])).rows[0];
  if (!s || s.user_id !== req.user.id) return res.status(403).json({ error: 'Not your subtask' });
  const status = req.body.status;
  if (!['TODO', 'IN_PROGRESS', 'DONE'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await q('UPDATE subtasks SET status=$1,updated_at=now() WHERE id=$2', [status, s.id]);
  try {
    const notion = await notionFor(await workspace(s.workspace_id));
    if (notion && s.notion_subtask_id) {
      await notion.pages.update({
        page_id: s.notion_subtask_id,
        properties: { Status: { select: { name: status === 'DONE' ? 'Done' : status === 'IN_PROGRESS' ? 'In Progress' : 'To Do' } } }
      });
    }
  } catch (e) {
    console.error('Notion status sync:', e.message);
  }
  res.json({ ok: true });
});

app.get('/api/notifications', auth(), async (req, res) => {
  res.json((await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id])).rows);
});

// Scheduled jobs
cron.schedule('0 8 * * *', async () => {
  try {
    await q("INSERT INTO notifications(user_id,type,message) SELECT DISTINCT f.user_id,'SUBTASK_OVERDUE','An assigned subtask is overdue.' FROM subtasks s JOIN tasks t ON t.id=s.task_id JOIN groups g ON g.id=t.group_id JOIN faculty f ON f.id=g.faculty_id WHERE s.due_date<CURRENT_DATE AND s.status<>'DONE' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=f.user_id AND n.type='SUBTASK_OVERDUE' AND n.created_at::date=CURRENT_DATE)");
  } catch (e) {
    console.error('Cron overdue check error:', e.message);
  }
});

cron.schedule('*/5 * * * *', async () => {
  try {
    for (const ws of (await q('SELECT * FROM workspaces WHERE notion_token_encrypted IS NOT NULL AND notion_tasks_db_id IS NOT NULL')).rows) {
      try {
        const notion = await notionFor(ws);
        const result = await notion.databases.query({ database_id: ws.notion_tasks_db_id });
        for (const page of result.results) {
          const status = page.properties?.Status?.select?.name;
          const mapped = status === 'Done' ? 'DONE' : status === 'In Progress' ? 'IN_PROGRESS' : status === 'To Do' ? 'TODO' : null;
          if (mapped) await q('UPDATE subtasks SET status=$1,updated_at=now() WHERE notion_subtask_id=$2 AND status<>$1', [mapped, page.id]);
        }
      } catch (e) {
        console.error('Notion poll error:', e.message);
      }
    }
  } catch (e) {
    console.error('Cron Notion poll error:', e.message);
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
