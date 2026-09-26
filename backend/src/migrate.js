import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log('No DATABASE_URL set. In local mode, migrations run automatically on startup via PGlite.');
  console.log('To run migrations against Supabase, set DATABASE_URL in your .env file:');
  console.log('DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.vlyfifpdsmimphchitnm.supabase.co:5432/postgres');
  process.exit(0);
}

const isRemoteOrSsl = connectionString.includes('supabase') || 
                      connectionString.includes('sslmode=require') || 
                      process.env.DB_SSL === 'true';

const db = new pg.Pool({
  connectionString,
  ssl: isRemoteOrSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  console.log('Connecting to database...');
  await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const sql = fs.readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8');
  await db.query(sql);
  console.log('Migration complete: All tables and types created successfully.');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
} finally {
  await db.end();
}
