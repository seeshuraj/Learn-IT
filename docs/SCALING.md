# Scaling runbook

LearnIT runs on the same code from a demo to many colleges. Capacity is raised by changing plans and environment variables, never by changing code. Upgrade when a contract is signed, before the college's accounts are created.

Sizing assumption: one university is about 2,000 accounts (1,500+ students plus faculty and administration). Peak concurrency is roughly 15–25% of accounts, at results release and assignment deadlines.

## What the code already handles

- **Campus networks.** Hundreds of students share one public IP. Every rate limit on a signed-in route is counted per user (institution + user id). The only per-IP limit is a pre-sign-in backstop of 20,000 requests per 15 minutes.
- **Several backend instances.** The API is stateless. Background jobs take a Postgres advisory lock, so only one instance runs each job.
- **Auth round trips.** A verified session is cached for 60 seconds (`AUTH_CACHE_TTL_MS`). Role and college are still read from the database on every request.
- **Tunable limits.** Every limit can be changed per deployment without a deploy (see the environment variables below).

## Plans by stage

Prices are approximate, at ₹95 per US$1. Check the vendor pricing pages before buying.

| Stage | Backend (Render, Singapore) | Database (Supabase) | Email |
|---|---|---|---|
| Demos, no clients | Starter, 1 instance, ~₹665/mo (US$7). Avoids the free plan's ~1-minute cold start during a pitch | Free is acceptable while it holds no real student data | Free tier |
| 1 university (~2,000 accounts) | Standard, 1 instance, ~₹2,375/mo (US$25) | Pro, ~₹2,375/mo (US$25), plus Small compute; daily backups | Paid tier, so the initial invites aren't capped per day |
| 2–3 universities (~6,000) | Standard × 2 instances, or Pro × 1 | Pro plus Medium compute; turn on point-in-time recovery | Same |
| 5+ universities (10,000+) | Pro × 2–3 with autoscaling | Pro plus Large compute; read replica for reports | Same; dedicated sending IP |

At ₹300 per student per semester, one university of 1,500 students brings in ₹4.5 lakh per semester. The infrastructure for that stage is under ₹10,000 per month.

The database region is currently `eu-west-1` (Ireland). Before the first contract, create the production project in `ap-south-1` (Mumbai) and migrate. This removes about 150 ms from every query for Indian users, and is simplest while there is little data.

## Settings to change when a college signs

### Supabase dashboard → Authentication → Rate Limits

These limits are per IP. The defaults would block a campus where everyone signs in at 9 a.m. through one IP.

| Setting | Default | Per 2,000-account college |
|---|---|---|
| Sign-ups and sign-ins (per 5 min, per IP) | 30 | 500 |
| Token refreshes (per 5 min, per IP) | 150 | 1,000 |
| Token verifications (per 5 min, per IP) | 30 | 300 |
| Emails sent (per hour) | 30 with custom SMTP | 500, or whatever your email plan allows |

Add the values per college: two colleges need 1,000 sign-ins per 5 minutes, and so on. Raising the sign-in limit also gives a password-guessing attacker more attempts per IP, so turn on CAPTCHA and leaked-password protection, and watch the auth logs during the first weeks.

### Render → Environment

| Variable | Default | When to change |
|---|---|---|
| `DB_POOL_MAX` | 10 | Keep `instances × DB_POOL_MAX` below the database connection limit, or point `DATABASE_URL` at the Supabase pooler. Minimum 3, because background jobs hold one connection while they run. |
| `AUTH_CACHE_TTL_MS` | 60000 | Set to `0` only if a revoked session must stop working instantly. |
| `RATE_USER_MAX` | 600 per 15 min | Per-person cap on general API calls. |
| `RATE_LOGIN_MAX` | 30 per 15 min | Per-person cap on sign-in profile loads. |
| `RATE_AI_MAX` | 40 per hour | Per-person AI chat and summaries; the main lever for AI cost. |
| `RATE_AI_GRADE_MAX` | 60 per hour | Per-instructor AI grading. |
| `RATE_UPLOAD_MAX` | 100 per day | Per-person file uploads. |
| `RATE_REPORT_MAX` | 10 per hour | Per-person report generation. |
| `RATE_IP_MAX` | 20,000 per 15 min | Pre-sign-in backstop per IP. Raise it if one campus IP serves more than about 3,000 active users. |

Rate-limit counters live in each instance's memory. With N instances, a user's effective limit is up to N times the setting. That is fine for fairness and cost control. Add a shared Redis store only if exact limits become a contractual requirement.

### Render → Settings

- Health check path: `/api/health`. Render then replaces a hung instance automatically.
- Region: Singapore, the closest Render region to India.

## Before go-live checklist

1. Database in Mumbai on Pro, with daily backups confirmed.
2. Backend on a paid Render plan in Singapore, with the health check path set.
3. Supabase Auth rate limits raised for the college's size.
4. Email plan sized for the invite batch; SPF and DKIM verified.
5. NVIDIA API quota checked against `colleges × students × RATE_AI_MAX` at peak.
6. Load test of 25% of the college's accounts signing in and browsing within 10 minutes.
