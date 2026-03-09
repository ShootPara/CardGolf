# CardGolf — Deployment Instructions

Version: 1.0  
Status: Current production deployment guide  
Production URL: https://cardgolf.unopenedparachute.workers.dev  
Repository: https://github.com/ShootPara/CardGolf

## 1. Purpose

This document explains how to run, deploy, and maintain CardGolf on Cloudflare.

CardGolf is a Cloudflare-native multiplayer web app with:
- a React + Vite frontend
- a Cloudflare Worker backend
- a Durable Object per table for authoritative live game state
- D1 for schema-backed support data and table hygiene

This guide is intended for the current production architecture.

---

## 2. Repo Areas

- `apps/web` — React frontend
- `worker` — Worker + Durable Object backend
- `db/migrations` — D1 migrations
- `docs` — project documentation

---

## 3. Deployment Model

### 3.1 Runtime shape
CardGolf is deployed as a **Cloudflare Worker application**, not a Pages app.

The production worker is responsible for:
- serving the built frontend assets
- exposing API routes
- exposing WebSocket routes
- connecting to Durable Objects and D1

### 3.2 Production routing
- frontend: served by Worker
- API: `/api/*`
- WebSocket: `/ws/*`

### 3.3 Production identity target
Production is intended to rely on Cloudflare Access / Google identity, with the authenticated user email provided to the Worker through the Cloudflare Access header.

---

## 4. Prerequisites

Before deploying, confirm the following are available:

- Node.js installed
- npm available
- Wrangler available directly or via `npx`
- Cloudflare account with Workers enabled
- D1 database created
- Durable Object binding configured
- required environment/config values present in Worker configuration
- GitHub repository connected if using Git-based CI/CD

---

## 5. Local Development

## 5.1 Frontend

From `apps/web`:

```bash
npm ci
npm run dev
````

Expected result:

- Vite dev server runs locally
- frontend becomes available for browser testing

## 5.2 Worker

From `worker`:

```bash
npm ci
npx wrangler dev --config wrangler.jsonc --port 8787
```

Expected result:

- Worker runs locally on port 8787
- API and WebSocket endpoints are available for testing

## 5.3 Typical local workflow

Use two terminals:

### Terminal A — frontend

From `apps/web`:

```bash
npm ci
npm run dev
```

### Terminal B — worker

From `worker`:

```bash
npm ci
npx wrangler dev --config wrangler.jsonc --port 8787
```

Typical local URLs:

- frontend: Vite local dev server
- worker: local Wrangler URL or `http://localhost:8787`

---

## 6. Database Setup

Apply D1 migrations before testing behavior that depends on schema.

From the repo root or appropriate working directory, apply migrations using Wrangler against the configured D1 database.

Typical sequence:

1. verify D1 database exists
2. ensure Worker config points to the correct database binding
3. apply migrations from `db/migrations`
4. confirm migration success before production testing

Use your actual database/binding names from the repo configuration.

---

## 7. Frontend Build

Build the frontend before production deploy so the Worker can serve current UI assets.

From `apps/web`:

```bash
npm ci
npm run build
```

Expected result:

- production assets are written to `apps/web/dist`

---

## 8. Worker Deploy

Deploy from `worker` using the project Wrangler config.

Current deployment command:

```bash
cd worker
npx wrangler deploy --config wrangler.jsonc
```

If building from a fresh state, the usual sequence is:

```bash
cd apps/web
npm ci
npm run build

cd ../../worker
npx wrangler deploy --config wrangler.jsonc
```

Expected result:

- Worker deploy completes successfully
- production hostname serves the current frontend and backend behavior

---

## 9. CI/CD

## 9.1 GitHub as source of truth

The GitHub repository should be treated as the source of truth for:
- code
- migrations
- docs
- deployment-related configuration

## 9.2 Current preferred shape

Preferred deployment flow:

1. commit changes to repo
2. push to `main`
3. verify deploy process completes successfully
4. validate production behavior

## 9.3 Build/deploy commands

Current expected commands are:

- build: `cd apps/web && npm ci && npm run build`
- deploy: `cd worker && npx wrangler deploy --config wrangler.jsonc`

If CI/CD is later formalized further, it should continue to follow the same production architecture:

- build frontend
- deploy Worker
- preserve D1 / Durable Object bindings
- validate auth-sensitive routes

---

## 10. Authentication and Access

## 10.1 Production expectation

Production is intended to use:
- Cloudflare Access
- Google identity
- Worker-side authenticated email from Cloudflare header

Expected header:
- `Cf-Access-Authenticated-User-Email`
## 10.2 Hardened behavior expectation

If authenticated identity is missing in production:
- Worker should return a clean JSON `401 Unauthorized`
- Worker should not throw an unhandled exception
- UI should surface a clean user-facing auth failure state where appropriate

## 10.3 Access policy

Cloudflare Access policy should cover the relevant production hostname and routes required by the app.

When validating auth:
- confirm Google login succeeds
- confirm authenticated header is present
- confirm Create Table works under authenticated production conditions

---

## 11. Post-Deploy Validation Checklist

After each production deploy, verify:
- homepage loads successfully
- static assets load correctly
- Create Table works
- lobby loads after table creation
- WebSocket connection succeeds
- player join flow works
- spectator path works
- game start works with 2+ players
- display names behave correctly
- owner controls work
- chat works
- turn flow works
- end-of-round flow works
- known HTTP 500 create-table path does not reproduce

---

## 12. Troubleshooting

## 12.1 Create Table returns HTTP 500

Likely causes:
- missing authenticated email in production
- unhandled auth-related null/invalid state
- misconfigured binding or runtime config

Checks:
- inspect Workers logs
- verify authenticated email header is present
- verify Worker bindings are valid
- verify D1 binding exists and is reachable
- return clean `401 Unauthorized` instead of throwing if identity is missing

## 12.2 Access / auth issues

Checks:
- verify Cloudflare Access policy covers the correct hostname and paths
- verify Google identity is allowed by policy
- verify the authenticated header is reaching the Worker
- verify the frontend is calling the correct production origin/routes

## 12.3 UI mismatch after deploy

Checks:
- rebuild frontend
- redeploy Worker
- confirm latest `apps/web/dist` assets are the ones being served
- confirm browser is not showing stale cached assets

## 12.4 WebSocket problems

Checks:
- verify Worker deploy completed cleanly
- verify WebSocket routes are still exposed under `/ws/*`
- verify table Durable Object bindings are configured correctly
- inspect Worker logs during connection attempts

## 12.5 Database / migration issues

Checks:
- verify the correct D1 database is bound
- confirm all migrations were applied
- verify no migration failed silently
- confirm production schema matches expected code paths

---

## 13. Maintenance Rules

- Keep docs updated when routes, auth handling, schema, or deployment commands change
- Use migrations for database changes rather than hand-editing production state
- Keep the GitHub repo as the source of truth
- Treat production auth handling as a first-class stability issue
- Re-test Create Table after auth-related changes
- Update this document whenever deployment steps materially change

---

## 14. Minimum Production Readiness Standard

A deployment should not be considered healthy unless:
- app loads correctly
- authenticated user can create a table
- second participant can join
- WebSocket stays connected through normal play
- owner moderation works
- round flow and scoring complete successfully
- no unhandled auth-related HTTP 500 occurs in normal production use