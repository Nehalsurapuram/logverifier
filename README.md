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
- [Node.js 22 LTS](https://nodejs.org/) — for the api and ai services
- [bun](https://bun.sh/) — workspace and dashboard tooling

## Getting started

```bash
cp .env.example .env     # adjust credentials if you like
bun install
bun run infra:up         # start postgres, prometheus, loki, grafana
bun run dev:web          # dashboard on http://localhost:3000
```

| Service    | URL                     | Credentials     |
| ---------- | ----------------------- | --------------- |
| Dashboard  | http://localhost:3000   | —               |
| Grafana    | http://localhost:3001   | `admin`/`admin` |
| Prometheus | http://localhost:9090   | —               |
| Loki       | http://localhost:3100   | —               |
| PostgreSQL | `localhost:5432`        | from `.env`     |

Grafana runs on 3001 because the dashboard owns 3000.

Useful scripts: `infra:down` (stop), `infra:logs` (tail), `infra:ps` (status),
`infra:reset` (stop **and delete all volumes**).

## Build phases

1. **Project foundation** ← current
2. Backend (Express)
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
