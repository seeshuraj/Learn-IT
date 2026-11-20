# Load test

Runs against the live API with an isolated, synthetic college, then deletes it.

```bash
# Google Cloud Shell (needs access to the project's Secret Manager)
bash <(curl -fsSL https://raw.githubusercontent.com/seeshuraj/Learn-IT/main/loadtest/run.sh)
```

It asks for the Supabase publishable key (Project Settings → API Keys), or reads `SUPABASE_PUBLISHABLE_KEY` if it's set.

- **Data:** `setup.mjs` creates "LearnIT Load Test …" (slug `learnit-load-test-…`): 300 students in 2nd year, 5 professors, 10 courses, 3,000 enrolments, 6,000 graded submissions, 6,000 published marks, notices and notifications. Logins exist only for the 36 accounts the test signs in as. Passwords are random and never saved.
- **Load:** `k6.js` ramps to 300 students over 8 minutes and holds for 4. 10 professors browse and autosave marks; 2 admins use the dashboard. There are no AI calls.
- **Pass bars:** under 1% failed requests; reads p95 under 800 ms; writes p95 under 1.5 s.
- **Clean-up:** `teardown.mjs` deletes every row of any `learnit-load-test-*` college, its users and their logins. It runs automatically, even if the test fails. Run it alone with `TEARDOWN_ONLY=1`.
