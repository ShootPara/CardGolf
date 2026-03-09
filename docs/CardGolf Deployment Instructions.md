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