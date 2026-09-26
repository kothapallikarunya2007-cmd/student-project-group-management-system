-- =======================================================================
-- Student Project Group Management System (SPGMS) - Supabase Schema
-- =======================================================================
-- You can run this script directly in the Supabase Dashboard -> SQL Editor
-- OR connect your backend via DATABASE_URL to run migrations automatically.
-- =======================================================================

-- 1. Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Custom Enumeration Types
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('HOD','FACULTY','STUDENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM ('PENDING','APPROVED','DENIED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE group_status AS ENUM ('FORMING','LOCKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE subtask_status AS ENUM ('TODO','IN_PROGRESS','DONE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM ('SUBTASK_OVERDUE','SUBTASK_ASSIGNED','ROLL_NUMBER_MISMATCH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE segregation_basis AS ENUM ('CGPA','MARKS','RANDOM');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Core Tables
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    handle_code TEXT UNIQUE NOT NULL,
    hod_user_id UUID,
    notion_token_encrypted TEXT,
    notion_parent_page_id TEXT,
    notion_projects_db_id TEXT,
    notion_tasks_db_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    status approval_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE workspaces ADD CONSTRAINT workspace_hod_fk FOREIGN KEY (hod_user_id) REFERENCES users(id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS student_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    roll_number TEXT NOT NULL,
    name TEXT,
    cgpa NUMERIC(4,2),
    section TEXT,
    matched_master_record_id UUID,
    is_flagged BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS master_student_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    roll_number TEXT NOT NULL,
    name TEXT NOT NULL,
    cgpa NUMERIC(4,2),
    section TEXT,
    uploaded_from_file TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(workspace_id, roll_number)
);

DO $$ BEGIN
    ALTER TABLE student_profiles ADD CONSTRAINT student_match_fk FOREIGN KEY (matched_master_record_id) REFERENCES master_student_records(id);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS faculty (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS setup_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    total_students INT,
    num_groups INT,
    team_size INT,
    num_faculty INT,
    segregation_basis segregation_basis NOT NULL DEFAULT 'CGPA'
);

CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    faculty_id UUID NOT NULL REFERENCES faculty(id),
    topic TEXT,
    status group_status NOT NULL DEFAULT 'FORMING',
    cgpa_band TEXT NOT NULL,
    notion_project_page_id TEXT,
    notion_project_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES student_profiles(id),
    UNIQUE(group_id, student_id),
    UNIQUE(student_id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    created_by_faculty_id UUID NOT NULL REFERENCES faculty(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    assigned_student_id UUID NOT NULL REFERENCES student_profiles(id),
    status subtask_status NOT NULL DEFAULT 'TODO',
    due_date DATE,
    notion_subtask_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Indices
CREATE INDEX IF NOT EXISTS users_workspace_idx ON users(workspace_id);
CREATE INDEX IF NOT EXISTS records_workspace_idx ON master_student_records(workspace_id);
CREATE INDEX IF NOT EXISTS groups_faculty_idx ON groups(faculty_id);

-- 5. Supabase PostgREST Permissions
DO $$ BEGIN
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
EXCEPTION
    WHEN OTHERS THEN null;
END $$;
