# Moving the API to Google Cloud Run (Mumbai)

Why: the database is in Supabase Mumbai (`ap-south-1`) and Render's closest region is Singapore. Every query paid a measured ~101 ms round trip. Running the API in Cloud Run `asia-south1` (Mumbai) puts it next to the database. Supabase, Vercel and the code stay as they are.

What you get: one always-on instance (background jobs keep running), automatic scale-out to more instances under load, deploys from GitHub on every merge to `main`, and a health check before any new version receives traffic.

Run every command in **Cloud Shell** (console.cloud.google.com → the `>_` icon, top right). It already has `gcloud`, `git` and `docker`.

---

## 1. Project and billing (console, 5 min)

1. console.cloud.google.com → project picker → **New project**, for example `learnit-prod`. Note the **Project ID** shown under the name (it may have a suffix).
2. **Billing** → link a billing account to the project. New Google Cloud accounts usually get free-trial credit; check the offer shown when you create the billing account.
3. **Billing → Budgets & alerts → Create budget** for this project, e.g. ₹10,000/month with alerts at 50%, 90% and 100%.

## 2. Variables used below

```bash
PROJECT_ID=learnit-prod            # your Project ID from step 1
REGION=asia-south1
REPO=seeshuraj/Learn-IT
gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA=learnit-api-runtime@$PROJECT_ID.iam.gserviceaccount.com
DEPLOY_SA=learnit-deployer@$PROJECT_ID.iam.gserviceaccount.com
```

If Cloud Shell restarts, run this block again before continuing.

## 3. Turn on the services

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com
gcloud artifacts repositories create learnit --repository-format=docker --location="$REGION" \
  --description="LearnIT API images"
```

## 4. Two service accounts, least privilege

- `learnit-api-runtime`: what the API runs as. It can read its secrets, nothing else.
- `learnit-deployer`: what GitHub Actions deploys as. It can push images and deploy this service.

```bash
gcloud iam service-accounts create learnit-api-runtime --display-name="LearnIT API runtime"
gcloud iam service-accounts create learnit-deployer --display-name="LearnIT GitHub deployer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/run.developer
gcloud artifacts repositories add-iam-policy-binding learnit --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser
```

## 5. Secrets (Secret Manager, stored in Mumbai)

Copy each value from Render → learnit-api-sg → **Environment**. Values are typed hidden and never land in shell history.

For `DATABASE_URL`, use Supabase → **Connect → Transaction pooler** (host `…pooler.supabase.com`, port **6543**), so several instances share connections safely.

```bash
for NAME in DATABASE_URL SUPABASE_SERVICE_ROLE_KEY NVIDIA_API_KEY CLAUDE_API; do
  read -rsp "$NAME: " VALUE; echo
  printf '%s' "$VALUE" | gcloud secrets create "$NAME" --data-file=- \
    --replication-policy=user-managed --locations="$REGION"
  gcloud secrets add-iam-policy-binding "$NAME" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
  unset VALUE
done
```

To change a secret later: `printf '%s' "new value" | gcloud secrets versions add NAME --data-file=-`, then deploy again (step 9 runs on every merge, or run the workflow by hand).

## 6. First deploy from Cloud Shell

```bash
git clone https://github.com/$REPO.git learn-it && cd learn-it
IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/learnit/api:first
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -t "$IMAGE" . && docker push "$IMAGE"

gcloud run deploy learnit-api \
  --image="$IMAGE" --region="$REGION" \
  --service-account="$RUNTIME_SA" \
  --allow-unauthenticated \
  --min-instances=1 --max-instances=4 \
  --cpu=1 --memory=1Gi --no-cpu-throttling \
  --concurrency=80 --timeout=3600 \
  --set-env-vars="^@^SUPABASE_URL=https://idytyybyyqutkgwrqjzl.supabase.co@ALLOWED_ORIGIN=https://www.learnitanalytics.com,https://learnitanalytics.com@APP_URL=https://www.learnitanalytics.com@NVIDIA_CHAT_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b,minimaxai/minimax-m3.1-flash" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,NVIDIA_API_KEY=NVIDIA_API_KEY:latest,CLAUDE_API=CLAUDE_API:latest"
```

- `ALLOWED_ORIGIN`: copy Render's value if it differs from the one shown. `^@^` makes `@` the separator, so the commas inside the value are kept.
- Copy any other non-secret settings you set on Render (`AI_MONTHLY_TOKEN_BUDGET`, `RATE_*`) the same way.
- `--min-instances=1 --no-cpu-throttling`: one instance always on, with CPU between requests, so background jobs keep running.
- `--max-instances=4`: with `DB_POOL_MAX` 5, at most 20 client connections. That needs the **transaction** pooler (port 6543); the session pooler (port 5432) allows only 15 clients in total and refuses the rest with `EMAXCONNSESSION`, which shows up as random 500s.
- `--timeout=3600`: long AI answers stream to the browser.

## 7. Check it

```bash
URL=$(gcloud run services describe learnit-api --region="$REGION" --format='value(status.url)')
echo "$URL"
curl -s "$URL/api/health"
gcloud logging read 'resource.type="cloud_run_revision" AND jsonPayload.msg="database round trip"' \
  --limit=1 --format='value(jsonPayload.medianMs)'
```

`/api/health` should answer `ok`, and the database round trip should be a few milliseconds (it was ~101 ms from Singapore).

## 8. Automatic deploys from GitHub (no keys stored)

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc learn-it \
  --location=global --workload-identity-pool=github \
  --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

echo "GCP_PROJECT_ID   = $PROJECT_ID"
echo "GCP_WIF_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/learn-it"
echo "GCP_DEPLOY_SA    = $DEPLOY_SA"
```

On GitHub: repo → **Settings → Secrets and variables → Actions → Variables** tab → add those three as **repository variables**. They are identifiers, not secrets.

From then on, every merge to `main` that touches the API:
1. runs the tests;
2. builds the image;
3. deploys a new revision with no traffic and checks `/api/health` on it;
4. switches traffic to it only if healthy.

Run it by hand: Actions → *Deploy API (Cloud Run)* → **Run workflow**.

## 9. Point the website at Cloud Run

Vercel → learn-it → **Settings → Environment Variables** → `VITE_API_BASE_URL` (Production) = the `$URL` from step 7 → **Save**. Then **Deployments** → latest production deployment → ⋯ → **Redeploy**. The value is built into the site, so a redeploy is required.

Smoke test on a phone and a laptop:
- sign in;
- open the dashboard and courses;
- open a note and ask the tutor a question;
- submit an assignment;
- as admin, try Data & Audit.

## 10. Roll back if needed

Set `VITE_API_BASE_URL` back to `https://learnit-api-sg.onrender.com` and redeploy on Vercel. Render keeps running, so it is a two-minute switch.

After a week without issues: on Render, suspend learnit-api-sg (and the old Frankfurt service), then delete them.

## Notes

- **Custom domain:** Cloud Run's built-in domain mapping isn't offered in `asia-south1`. The `*.run.app` address works as is, because only the website calls it. For `api.learnitanalytics.com`, put a Global external Application Load Balancer in front (about US$18/month, adds Cloud Armor), later if needed.
- **Logs:** Cloud Run → learnit-api → **Logs**. Each request line includes `dbQueries` and `dbMs`.
- **Scaling up:** raise `--max-instances`. Run background jobs separately with a second service using `PROCESS_ROLE=worker` and `PROCESS_ROLE=api` on this one (see `docs/SCALING.md`).
- **Cost:** one always-on instance (1 vCPU, 1 GiB) is roughly ₹4,500/month (US$47) at list price. Extra instances are billed only while they run.
