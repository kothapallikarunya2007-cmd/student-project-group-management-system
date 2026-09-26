import 'dotenv/config'; import fs from 'node:fs'; import pg from 'pg';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try { await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await db.query(fs.readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8')); console.log('Migration complete'); } finally { await db.end(); }
