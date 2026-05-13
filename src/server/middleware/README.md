# Middleware — P1-4 auth hardening

This directory contains all Express middleware added as part of the P1-4 auth audit.

## Files

### `auth.ts`
Core auth middleware. All protected routes must use this.

- `requireAuth` — validates `Authorization: Bearer <token>` via `supabase.auth.getUser()` (live server-side check, not just JWT decode). Resolves `legacyUserId` and `role` from `public.user_identity_map`. Attaches `req.auth`.
- `requireRole(...roles)` — gate that allows only specified roles. Must follow `requireAuth`.
- `requireSelfOrAdmin(paramName)` — ensures the route `:id` param matches the caller's own `legacyUserId`, or the caller is an admin.

**Why `getUser()` not `getClaims()`:**  
`getClaims()` only does local JWT signature and expiry validation — it does not detect server-side revoked sessions. `getUser()` makes a live call to Supabase Auth and is the only safe option for protected backend routes.

**Why role from DB not JWT:**  
JWT `app_metadata.role` can be stale and cannot be instantly revoked. Role is always resolved from `public.user_identity_map` at request time.

### `validate.ts`
Zod-based schema validation for request body, query, and params.

### `requestId.ts`
Attaches a UUID to every request as `req.id` and returns it in `X-Request-Id` response header.

### `logger.ts`
Structured JSON logger that emits one log line per request at response finish.

## Route protection matrix

| Route pattern | Middleware applied |
|---|---|
| `POST /api/login` | None (public — issues token) |
| `GET /api/health` | None (public) |
| `GET /api/courses` | `requireAuth` |
| `GET /api/student/:id/*` | `requireAuth`, `requireSelfOrAdmin('id')` |
| `GET /api/students/:id/*` | `requireAuth`, `requireSelfOrAdmin('id')` |
| `POST /api/submissions` | `requireAuth`, `requireRole('student')` |
| `POST /api/submissions/upload` | `requireAuth`, `requireRole('student')` |
| `GET /api/instructor/*` | `requireAuth`, `requireRole('instructor', 'admin')` |
| `POST /api/instructor/*` | `requireAuth`, `requireRole('instructor', 'admin')` |
| `GET /api/admin/*` | `requireAuth`, `requireRole('admin')` |
| `POST /api/admin/*` | `requireAuth`, `requireRole('admin')` |
| `PUT /api/admin/*` | `requireAuth`, `requireRole('admin')` |
| `DELETE /api/admin/*` | `requireAuth`, `requireRole('admin')` |
| `GET /api/modules/:id/notes` | `requireAuth` |
| `POST /api/modules/:id/notes` | `requireAuth`, `requireRole('instructor', 'admin')` |
| `DELETE /api/notes/:id` | `requireAuth`, `requireRole('instructor', 'admin')` |
| `GET /api/notes/:id/proxy` | `requireAuth` |
| `POST /api/ai/*` | `requireAuth` |
| `POST /api/submissions/:id/grade` | `requireAuth`, `requireRole('instructor', 'admin')` |
| `GET /api/instructor/submissions` | `requireAuth`, `requireRole('instructor', 'admin')` |
