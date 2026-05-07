# AURA — Implementation Plan & System Reference

> **Last updated:** 2026-05-07  
> **Project:** Samsung PRISM Hackathon — Proactive Ambient Agent  
> **Repository:** `d:\SAMSUNG_PRISM\p1\samsung_hack_01`  
> **Runtime:** Node.js 22+ (experimental SQLite), TypeScript 5.7, tsx  
> **Status:** Backend 100% complete. Frontend in Lovable (external). Android port pending.

---

## 0. Quick Start

```bash
cd d:\SAMSUNG_PRISM\p1\samsung_hack_01
npm install
npm run dev          # starts daemon on http://localhost:3000
```

Environment variables (optional — all have safe defaults):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `TICK_INTERVAL_SEC` | `30` | Scheduler loop interval |
| `TELEGRAM_BOT_TOKEN` | *(empty)* | Telegram delivery (falls back to console) |
| `TELEGRAM_CHAT_ID` | *(empty)* | Telegram chat target |
| `OLLAMA_URL` | *(empty)* | Ollama LLM endpoint (falls back to templates) |
| `OLLAMA_MODEL` | `llama3.2` | Model name for narration |
| `AUDIT_HMAC_SECRET` | `dev-secret-change-me` | HMAC key for audit chain |
| `VOICE_ENABLED` | `1` | `0` to disable TTS |

---

## 1. Architecture Overview

AURA is a **proactive daemon** — it runs in the background and decides *on its own* when to speak. It is NOT a chatbot.

### 1.1 The 4 Primitives

| Primitive | File | Role |
|---|---|---|
| **SOUL** | `SOUL.md` | Hand-authored personality, cost weights, quiet hours |
| **HEARTBEAT** | `HEARTBEAT.yaml` | Cron-like schedule — when skills are eligible to fire |
| **TWIN** | `TWIN.md` + `src/twin/learn.ts` | Learned behavioral model — acceptance rates, patterns |
| **Skills** | `src/skills/*/index.ts` | Isolated logic modules (morning brief, hydration, etc.) |

### 1.2 Decision Pipeline (PRISM)

```
Sensor Data → Fusion (p_need) → Gate (p_need × p_accept > τ) → Adversary (veto?) → Shadow AURA (borderline review) → Deliver or Suppress
```

| Stage | File | Description |
|---|---|---|
| **Sensor Fusion** | `src/pi-engine/fusion.ts` | Softmax-weighted attention across 5 signals → `p_need` |
| **Fast Gate** | `src/pi-engine/gate.ts` | Bayesian threshold: utility vs. calibrated τ |
| **Calibration** | `src/pi-engine/calibration.ts` | Per-context (skill × hour-bucket) adaptive cost tuning |
| **Adversary** | `src/pi-engine/adversary.ts` | 7-rule deterministic critic; can veto weak nudges |
| **Shadow AURA** | `src/pi-engine/shadow.ts` | LLM-based slow-mode counterfactual for borderline calls |

### 1.3 LLM Philosophy

> **Code thinks. LLM speaks.**

The LLM (Ollama) is *only* used for narration — it translates structured data into natural language. It never learns, writes state, or triggers decisions. If Ollama is offline, high-quality fallback templates are used. The system is fully functional without any LLM.

---

## 2. File Map

```
samsung_hack_01/
├── SOUL.md                        # Personality + cost weights
├── HEARTBEAT.yaml                 # Scheduler tick definitions
├── TWIN.md                        # Persisted learned patterns
├── IMPLEMENTATION_PLAN.md         # ← This file
├── README.md                      # Project overview
├── DECK.md                        # Pitch deck content
├── package.json                   # Dependencies
├── tsconfig.json                  # TypeScript config (strict)
├── data/
│   └── aura.db                    # SQLite WAL-mode database (auto-created)
├── eval/
│   ├── harness.ts                 # Evaluation harness (60-day synthetic traces)
│   └── results.json               # Eval metrics (F1, false alarm rates)
├── public/                        # Static HTML pages (landing, dev, simple)
├── scripts/
│   └── inspect-audit.mjs          # Audit log inspector
└── src/
    ├── index.ts                   # Entry point — boots daemon
    ├── config.ts                  # Env vars + paths
    ├── db.ts                      # SQLite schema, settings, pruning
    ├── scheduler.ts               # Tick loop + prewarm logic
    ├── server.ts                  # Express HTTP server (all API routes)
    ├── soul.ts                    # SOUL.md parser
    ├── twin.ts                    # TWIN.md parser + pattern reader
    ├── i18n.ts                    # Multi-language support (en/hi/kn)
    ├── server/
    │   └── simulate.ts            # Simulation API router
    ├── pi-engine/
    │   ├── fusion.ts              # Cross-modal sensor fusion
    │   ├── gate.ts                # Bayesian decision gate
    │   ├── calibration.ts         # Edge-PRISM cost calibration
    │   ├── adversary.ts           # Deterministic veto critic
    │   ├── shadow.ts              # LLM slow-mode reviewer
    │   └── intent.ts              # Chat intent router (POST /api/say)
    ├── gateway/
    │   ├── ollama.ts              # LLM narration + health check
    │   ├── telegram.ts            # Message delivery (Telegram or console)
    │   ├── voice.ts               # TTS (macOS say / Windows PowerShell)
    │   ├── weather.ts             # Open-Meteo weather API
    │   ├── actions.ts             # Timer/note/quiet-block actions
    │   ├── lookup.ts              # Web search stub
    │   └── system.ts              # System info queries
    ├── skills/
    │   ├── _lib.ts                # Shared skill runner (gate + delivery)
    │   ├── morning_brief/         # Daily morning briefing
    │   ├── commute_guardian/       # Commute departure alerts
    │   ├── meeting_reminder/      # Pre-meeting nudges
    │   ├── hydration_reminder/    # Context-aware water reminders
    │   ├── standup_break/         # Sedentary break alerts
    │   ├── eod_wrap/              # End-of-day summary
    │   └── wind_down/             # Bedtime wind-down coach
    ├── score/
    │   └── compute.ts             # Day-Readiness Score (CRS) calculator
    ├── twin/
    │   └── learn.ts               # Behavioral pattern learner
    ├── audit/
    │   └── log.ts                 # HMAC-chained audit log
    ├── data/
    │   └── seed.ts                # Demo data seeder
    ├── demo/
    │   └── runner.ts              # Auto-demo orchestrator
    ├── eval/
    │   └── harness.ts             # Evaluation framework
    └── cli/
        └── tick.ts                # Manual tick CLI command
```

---

## 3. Complete API Reference

Base URL: `http://localhost:3000` (tunneled via ngrok/localtunnel for Lovable)

### 3.1 Dashboard APIs

| Method | Endpoint | Purpose | Response shape |
|---|---|---|---|
| `GET` | `/api/status` | **Master dashboard endpoint** — all data in one call | `{ score, next_event, last_message, hrv, voice_enabled, ollama, ts }` |
| `GET` | `/api/score` | Raw readiness score | `{ total, components: { sleep, activity, calendar_load, stress_balance } }` |
| `GET` | `/api/last` | Last sent message + next event | `{ last_message, next_event, voice_enabled }` |
| `GET` | `/health` | System health | `{ ollama: { online, model, checked_at } }` |

### 3.2 Chat

| Method | Endpoint | Body | Response |
|---|---|---|---|
| `POST` | `/api/say` | `{ transcript: string, lang?: "en"|"hi"|"kn" }` | `{ reply: string, intent: string, ... }` |

### 3.3 Skills & Feedback

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/skill_runs` | Last 30 skill executions |
| `POST` | `/api/skill_runs/:id/feedback` | `{ action: "accept"|"dismiss" }` — teaches the gate |
| `GET` | `/api/activity?days=7` | Aggregated stats: per-skill + per-day + acceptance rate |
| `POST` | `/api/run/morning_brief` | Manually trigger morning brief |
| `POST` | `/api/run/commute_guardian` | Manually trigger commute guardian |
| `POST` | `/api/tick` | Force one scheduler tick |
| `POST` | `/api/learn` | Force TWIN re-learning |
| `GET` | `/api/twin/patterns` | Read current learned patterns |

### 3.4 Calendar

| Method | Endpoint | Body |
|---|---|---|
| `GET` | `/api/calendar` | List all events (50 max) |
| `POST` | `/api/calendar` | `{ start_ts, end_ts, title, location? }` |
| `DELETE` | `/api/calendar/:id` | Remove event |

### 3.5 Sensors

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/hrv` | `{ rmssd: number }` (20-300) | Galaxy Watch HRV ingestion |
| `GET` | `/api/hrv` | — | Current stress level |

### 3.6 Settings & Voice

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/settings` | All user settings |
| `POST` | `/api/settings` | `{ key: value, ... }` — update settings |
| `GET` | `/api/voice` | Voice enabled status |
| `POST` | `/api/voice` | `{ enabled: boolean }` |
| `POST` | `/api/voice/test` | `{ text: string }` — test TTS |

### 3.7 Audit & Gate Testing

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/audit` | Audit chain verification + last 50 entries |
| `POST` | `/api/gate/test` | `{ skill?, text?, importance? }` — test gate decision without side effects |
| `GET` | `/api/quiet` | Current quiet-block status |
| `GET` | `/api/twin` | Raw TWIN data |
| `GET` | `/api/soul` | Raw SOUL data |

### 3.8 Simulation (Demo Control Panel)

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/simulate/reset` | — | Clear all telemetry (fresh demo) |
| `POST` | `/api/simulate/scenario/busy` | — | Inject 6 meetings + high stress + low steps |
| `POST` | `/api/simulate/scenario/relaxed` | — | Clear calendar + high steps + low stress |
| `POST` | `/api/simulate/steps` | `{ count?, hour?, date? }` | Inject step data |
| `POST` | `/api/simulate/hrv` | `{ stress: 0.0-1.0 }` | Inject HRV stress |

### 3.9 Demo Orchestration

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/demo/start` | Start auto-demo sequence |
| `POST` | `/api/demo/stop` | Stop demo |
| `GET` | `/api/demo/state` | Demo progress |
| `POST` | `/api/narrate` | `{ text }` — push text into AURA's voice |

---

## 4. Database Schema (SQLite WAL)

File: `data/aura.db` (auto-created on first boot)

| Table | Purpose | Key columns |
|---|---|---|
| `events` | Raw telemetry log | `ts, kind, payload` |
| `calendar` | User's calendar events | `start_ts, end_ts, title, location` |
| `sleep` | Sleep records | `date, duration_min, quality` |
| `steps` | Hourly step counts | `date, hour, count` (unique on date+hour) |
| `notifications` | App notification log | `ts, source, cleared` |
| `skill_runs` | Every skill execution + feedback | `ts, skill, accepted, dismissed, payload` |
| `audit_log` | HMAC-chained decision log | `ts, kind, payload, prev_hash, hash` |
| `scheduler_state` | Per-tick last-run timestamps | `tick_id, last_run` |
| `prewarm_cache` | Shadow AURA pre-computed verdicts | `skill, ts, verdict` |
| `quiet_blocks` | User-initiated DND periods | `start_ts, end_ts, reason` |
| `notes` | User notes | `ts, body` |
| `timers` | User timers | `label, end_ts, fired` |
| `settings` | Key-value config store | `key, value, updated_at` |

---

## 5. What Is DONE ✅

### 5.1 Core Architecture
- [x] SOUL, HEARTBEAT, TWIN, Skills primitives
- [x] SQLite database with WAL mode + 13 tables
- [x] Scheduler with tick-based execution + local-timezone awareness
- [x] Demo data seeder (14 days of sleep, steps, 20 skill runs)

### 5.2 Decision Engine (PRISM)
- [x] Cross-modal sensor fusion (5 signals, softmax attention weights)
- [x] Bayesian gate with calibrated τ threshold
- [x] Edge-PRISM per-context cost calibration (skill × hour-bucket)
- [x] Adversary critic (7 veto rules, deterministic)
- [x] Shadow AURA slow-mode LLM review (with prewarm caching)
- [x] Sensor decay: HRV fades after 2h, stale steps → neutral

### 5.3 Skills (7 active)
- [x] `morning_brief` — daily agenda + readiness score
- [x] `commute_guardian` — departure timing alerts
- [x] `meeting_reminder` — pre-meeting nudges (every-minute cadence)
- [x] `hydration_reminder` — fuses HRV stress + time-of-day + activity
- [x] `standup_break` — 2-hour sedentary window detection
- [x] `eod_wrap` — day quality summary + tomorrow prep
- [x] `wind_down` — adaptive bedtime coach based on tomorrow's calendar

### 5.4 Gateways
- [x] Telegram delivery (with console fallback)
- [x] Ollama LLM narration (with template fallback)
- [x] Voice TTS: macOS (`say`) + Windows (PowerShell SpeechSynthesizer)
- [x] Weather: Open-Meteo API
- [x] Chat: Full intent router (POST /api/say) with timer/note/quiet/settings actions

### 5.5 Server & API
- [x] Express server with 25+ REST endpoints
- [x] CORS: wildcard origin (safe for single-user daemon)
- [x] Localtunnel/ngrok bypass headers
- [x] Global error handler (async-safe)
- [x] Request body size cap (256kb)
- [x] Input validation on all POST endpoints

### 5.6 Data Management
- [x] Automated pruning: prewarm (2h), events (30d), audit (90d), notifications (30d)
- [x] Nightly TWIN re-learning (03:00 AM in HEARTBEAT)
- [x] HMAC-chained audit log with verification endpoint

### 5.7 Developer Tooling
- [x] Simulation API (/api/simulate/*) for frontend testing
- [x] Gate test endpoint (/api/gate/test)
- [x] Auto-demo orchestrator (/api/demo/start)
- [x] Eval harness with 60-day synthetic traces
- [x] `tsc --strict --noEmit` passes with 0 errors

### 5.8 Frontend (Lovable — External)
- [x] Dashboard UI built in Lovable (React + Tailwind + shadcn)
- [x] Connected to backend via ngrok/localtunnel tunnel
- [x] Pages: Dashboard, Skills Log, Calendar, Simulate, Audit Log

---

## 6. What Is IN PROGRESS 🔄

### 6.1 Frontend-Backend Connectivity
- [ ] **Tunnel stability**: localtunnel gives 503 errors; switch to ngrok with free static domain (helper: `npm run tunnel`)
- [x] **Lovable bypass header**: static UI now sets `"bypass-tunnel-reminder": "true"` on all fetch calls
- [x] **Offline graceful degradation**: static UI caches last good responses and shows them when the tunnel drops

Recommended ngrok setup (free tier):

```bash
ngrok http 3000
```

Use the generated HTTPS URL as the Lovable backend base URL.

---

## 7. What Is LEFT TO DO ⬜

### 7.1 Phase 3: Samsung Hardware Bridge (Post-Hackathon)
- [ ] **Samsung Health Data SDK**: Replace `/api/hrv` stub with real Galaxy Watch HRV stream
- [ ] **Samsung Health Steps**: Replace `/api/simulate/steps` with real pedometer data
- [ ] **Samsung Neural SDK / Gauss-on-NPU**: Port Ollama inference to on-device NPU
- [ ] **Knox Personal Data Engine**: Move SQLite + HMAC audit to Knox secure storage
- [ ] **Foreground Android Service**: Convert Node.js daemon to Android service
- [ ] **Galaxy AI Integration**: Surface TWIN/SOUL into Samsung OS settings

### 7.2 Production Hardening (For 1M+ Users)
- [ ] **Rate limiting**: Add `express-rate-limit` to prevent API abuse
- [x] **Rate limiting**: Global + endpoint-specific throttles
- [x] **Authentication**: API key enforced in production (`AURA_API_KEY`)
- [x] **Database migration system**: Schema versioning + migration hooks (baseline v1)
- [x] **Health monitoring**: JSON metrics + Prometheus-style `/metrics`
- [x] **Graceful shutdown**: SIGTERM handler to flush WAL and close DB
- [ ] **Horizontal scaling**: Replace in-process SQLite with PostgreSQL for multi-instance

### 7.3 Demo Polish
- [ ] **Demo Video Script**: Record a narrated walkthrough showing AURA's proactive behavior
- [ ] **Presentation Deck**: Update DECK.md with live screenshots from Lovable UI
- [x] **Demo Video Script**: Drafted script in `demo/VIDEO_SCRIPT.md`
- [ ] **Presentation Deck**: Update DECK.md with live screenshots from Lovable UI
- [x] **Edge case testing**: Added `npm run edge:cases` to validate empty/no-HRV/dismissed flows

---

## 8. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| SQLite is single-writer | Fine for single-user; blocks at scale | Phase 3: PostgreSQL migration |
| Node.js SQLite is "experimental" | Console warning on every boot | Harmless; stable in practice |
| Ollama must be running for LLM narration | Fallback templates are used | Templates are high quality |
| Localtunnel is unreliable (503s) | Frontend shows "AURA offline" | Switch to ngrok free tier |
| No auth/multi-user | Anyone with the URL can access API | Single-user design; add JWT for prod |
| `meeting_reminder` fires every minute | Verbose scheduler logs | By design — needs minute-level precision |

---

## 9. Commands Reference

```bash
npm run dev          # Start daemon with hot-reload (tsx watch)
npm run start        # Start daemon without hot-reload
npm run seed         # Seed demo data into existing DB
npm run reseed       # Delete DB + reseed from scratch
npm run tick         # Run one scheduler tick manually
npm run learn        # Run TWIN learner manually
npm run eval         # Run evaluation harness
npm run inspect:audit  # Inspect the audit log
```

---

## 10. For Any AI Model Continuing This Work

1. **Read SOUL.md** first — it defines AURA's personality and constraints.
2. **Read HEARTBEAT.yaml** — it defines when each skill is eligible to fire.
3. **The decision pipeline** is in `src/pi-engine/` — fusion → gate → adversary → shadow.
4. **To add a new skill**: create `src/skills/your_skill/index.ts`, export a `run()` function matching the `SkillRunner` type, register it in `src/scheduler.ts` SKILLS map, add a tick entry in `HEARTBEAT.yaml`.
5. **All API routes** are in `src/server.ts` (main) and `src/server/simulate.ts` (simulation).
6. **TypeScript strict mode** is enforced — run `tsc --noEmit --strict` before committing.
7. **The DB uses Node's built-in `DatabaseSync`** (not better-sqlite3). There is no `.transaction()` method — use `db.exec("BEGIN")` / `db.exec("COMMIT")` for atomicity.
8. **Frontend** is built in Lovable (external SaaS). The backend exposes everything the frontend needs via `/api/status` (single-call dashboard data).
