# logverifier

A sample application instrumented end to end, monitored by Prometheus and Loki, visualized in
Grafana, with an AI service that detects anomalies, correlates metrics with logs, performs
root-cause analysis, and produces actionable summaries.

```
User → Sample Backend → Prometheus → Grafana
                     ↘  Loki      ↗
                          ↓
                  AI Analysis Service
                          ↓
                     LLM Provider
                          ↓
      Anomaly + Root Cause + Evidence + Severity + Recommendations
```

## Layout

| Path              | What it is                                              | Phase |
| ----------------- | ------------------------------------------------------- | ----- |
| `apps/web`        | Next.js dashboard (the AI dashboard surface)            | 11    |
| `apps/api`        | Express + PostgreSQL sample backend                     | 2     |
| `apps/ai`         | Anomaly detection + LLM analysis service                | 9–10  |
| `packages/*`      | Shared TypeScript types                                 | as needed |
| `infra/`          | Docker Compose, Prometheus, Loki, Grafana configuration | 1     |

## Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) — runs PostgreSQL, Prometheus, Loki, Grafana
- [bun](https://bun.sh/) — workspace tooling, and the runtime for the api and ai services

## Getting started

```bash
cp .env.example .env     # adjust credentials if you like
bun install
bun run infra:up         # start postgres, api, prometheus, loki, grafana
bun run dev:web          # dashboard on http://localhost:3000
bun run dev:api          # sample backend on http://localhost:4000
```

| Service    | URL                     | Credentials     |
| ---------- | ----------------------- | --------------- |
| Dashboard  | http://localhost:3000   | —               |
| API        | http://localhost:4000   | —               |
| Grafana    | http://localhost:3001   | `admin`/`admin` |
| Prometheus | http://localhost:9090   | —               |
| Loki       | http://localhost:3100   | —               |
| PostgreSQL | `localhost:5432`        | from `.env`     |

Grafana runs on 3001 because the dashboard owns 3000.

The api answers `GET /healthz` (liveness) and `GET /readyz` (readiness — 503 until
every dependency it probes is reachable). Every response carries an `x-request-id`;
phase 4 puts that id on each log line so Grafana can pivot from a log to its request.

Useful scripts: `infra:down` (stop), `infra:logs` (tail), `infra:ps` (status),
`infra:reset` (stop **and delete all volumes**).

## Build phases

1. Project foundation
2. **Backend (Express)** ← current
3. Database (PostgreSQL)
4. Structured logging
5. Prometheus metrics
6. Loki log shipping
7. Grafana dashboards
8. Failure simulator
9. Anomaly detection
10. AI analysis (LLM adapter)
11. AI dashboard
12. Testing, security, deployment

Each phase is validated before the next begins.
