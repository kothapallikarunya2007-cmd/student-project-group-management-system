# Student Project Group Management System

Full-stack workspace app for HODs, faculty, and students. It uses Express/PostgreSQL, JWT + bcrypt authentication, React, SheetJS, scheduled jobs, and optional Notion integration.

## Run locally

1. Copy `.env.example` to `.env` and set a secure `JWT_SECRET`.
2. Install dependencies: `npm install && npm install --prefix backend && npm install --prefix frontend`.
3. Run `npm run dev`, then open `http://localhost:5173`.

With no `DATABASE_URL`, the API automatically creates a persistent embedded PGlite database in `backend/.pglite`; this is the fastest way to run the app locally. Set `DATABASE_URL` to use production PostgreSQL instead. The schema is automatically installed on first startup. Docker PostgreSQL remains available with `docker compose up -d db`, after which run `npm run db:migrate`.
5. Open `http://localhost:5173`.

The HOD signup creates a workspace and invite handle. Import an `.xlsx` sheet with `roll_number`, `name`, `cgpa`, and `section`, approve join requests, save setup, then generate groups. Group creation requires the configured group/faculty counts to match. Re-generating deletes only unlocked groups.

## Deploy the frontend to Vercel

The Vercel configuration builds the React frontend and forwards `/api/*` requests to the hosted Render API at `https://student-project-group-management-system.onrender.com`. Deploy the repository with its root directory set to the repository root; the included `vercel.json` provides the install, build, output, and API rewrite settings.

Set the backend's production environment variables in Render, including a strong `JWT_SECRET` and a persistent PostgreSQL `DATABASE_URL`. After deploying the frontend, open `/api/health` on the Vercel domain to verify the proxy reaches the API. The first request may take longer if the Render service is waking from sleep.

## Notion

During HOD signup, supply a workspace-owned integration token and the existing Projects and Tasks database IDs. The token is AES-256-GCM encrypted when `TOKEN_ENCRYPTION_KEY` is configured (a base64 32-byte key). Locked groups create a Projects record; assigned subtasks create Tasks records. Statuses are pushed when a student marks an assigned task done and read from Notion every five minutes. The expected Notion properties are `Name`, `Status`, `Title`, `Assignee`, `Due Date`, and `Project`.

## API highlights

- `POST /api/auth/hod-signup`, `POST /api/auth/join`, `POST /api/auth/login`
- HOD: `/api/hod/overview`, `/import`, `/config`, `/generate-groups`, `/requests/:id`
- Faculty: `/api/faculty/groups`, `/groups/:id`, `/groups/:id/move`, `/groups/:id/lock`, `/groups/:id/tasks`, `/tasks/:id/subtasks`
- Student: `/api/student/dashboard`, `/api/student/subtasks/:id`, `/api/export/students.xlsx`
