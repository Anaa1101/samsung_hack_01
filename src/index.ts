import { config } from "./config.js";
import { db, recordEvent, setShuttingDown } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { createServer } from "./server.js";
import { append as auditAppend, verifyChain } from "./audit/log.js";
import { seed } from "./data/seed.js";
import { countCalibratedContexts } from "./pi-engine/calibration.js";
import { checkOllamaHealth } from "./gateway/ollama.js";
import { speakWithRetry } from "./gateway/voice.js";
import type { Server } from "node:http";

function maybeSeed(): void {
  const row = db.prepare("SELECT COUNT(*) AS c FROM calendar").get() as
    | { c: number }
    | undefined;
  if (!row || row.c === 0) {
    console.log("[init] empty DB, seeding demo data...");
    seed();
  }
}

function recoverTimers(): void {
  const now = new Date();
  const rows = db
    .prepare("SELECT id, label, end_ts FROM timers WHERE fired = 0")
    .all() as Array<{ id: number; label: string; end_ts: string }>;
  if (rows.length === 0) return;

  for (const row of rows) {
    const end = new Date(row.end_ts);
    const remainingMs = end.getTime() - now.getTime();
    if (remainingMs <= 0) {
      const message = `Timer up: ${row.label}.`;
      void speakWithRetry(message);
      db.prepare("UPDATE timers SET fired = 1 WHERE id = ?").run(row.id);
      recordEvent("timer_fired", { label: row.label, minutes: 0, recovered: true });
      auditAppend("timer_fired", { label: row.label, minutes: 0, recovered: true });
      auditAppend("timer_recovered", { id: row.id, label: row.label, overdue: true });
      continue;
    }
    setTimeout(() => {
      const message = `Timer up: ${row.label}.`;
      void speakWithRetry(message);
      db.prepare("UPDATE timers SET fired = 1 WHERE id = ?").run(row.id);
      recordEvent("timer_fired", { label: row.label, minutes: Math.round(remainingMs / 60000), recovered: true });
      auditAppend("timer_fired", { label: row.label, minutes: Math.round(remainingMs / 60000), recovered: true });
      auditAppend("timer_recovered", { id: row.id, label: row.label, overdue: false });
    }, remainingMs).unref();
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On SIGTERM / SIGINT, AURA:
//   1. Stops accepting new HTTP connections.
//   2. Flushes the WAL journal to the main DB file.
//   3. Closes the SQLite database handle cleanly.
//   4. Logs the shutdown event to the audit chain.
// This prevents data loss if the process is killed by a container orchestrator,
// systemd, or Ctrl-C during development.
function setupGracefulShutdown(server: Server): void {
  let shutting_down = false;

  const shutdown = (signal: string) => {
    if (shutting_down) return; // prevent double-shutdown
    shutting_down = true;
    setShuttingDown(true);
    console.log(`\n[shutdown] ${signal} received — stopping AURA...`);

    // 1. Stop accepting new connections. Give in-flight requests 5s to finish.
    server.close(() => {
      console.log("[shutdown] HTTP server closed.");
    });

    // 2. Audit the shutdown event.
    try {
      auditAppend("daemon_stop", { signal, pid: process.pid });
    } catch { /* best-effort — DB may already be locked */ }

    // 3. Flush WAL and close SQLite. Using exec() because checkpoint is sync.
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      console.log("[shutdown] Database flushed and closed.");
    } catch (err) {
      console.error("[shutdown] DB close error (non-fatal):", err);
    }

    // 4. Give the HTTP server a hard deadline, then exit.
    setTimeout(() => {
      console.log("[shutdown] Forced exit after timeout.");
      process.exit(0);
    }, 5000).unref(); // unref so it doesn't keep the event loop alive
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

// ── Uncaught error handlers ───────────────────────────────────────────────────
// These prevent the daemon from crashing on unexpected errors. The error is
// logged to the audit chain and to stderr, but the process continues running.
process.on("uncaughtException", (err) => {
  console.error("[FATAL] uncaught exception:", err);
  try { auditAppend("uncaught_exception", { message: err.message, stack: err.stack?.slice(0, 500) }); } catch {}
});

process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] unhandled rejection:", reason);
  try {
    const msg = reason instanceof Error ? reason.message : String(reason);
    auditAppend("unhandled_rejection", { message: msg });
  } catch {}
});

function main(): void {
  console.log("AURA daemon starting...");
  console.log(`  db:    ${config.paths.db}`);
  console.log(`  soul:  ${config.paths.soul}`);
  console.log(`  beat:  ${config.paths.heartbeat}`);
  console.log(`  twin:  ${config.paths.twin}`);

  maybeSeed();
  recoverTimers();
  auditAppend("daemon_start", { version: "0.1.0", pid: process.pid });

  const verify = verifyChain();
  if (!verify.ok) {
    console.warn(`[audit] chain broken at id ${verify.broken_at} — continuing in dev mode`);
  } else {
    console.log("[audit] chain verified");
  }

  const calibratedN = countCalibratedContexts();
  console.log(`Edge-PRISM calibration: ACTIVE (${calibratedN} contexts loaded)`);

  startScheduler();

  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`AURA dashboard:  http://localhost:${config.port}`);
    void checkOllamaHealth().then((h) => {
      if (h.online) {
        console.log(`Ollama: ONLINE — model ${h.model ?? config.ollama.model} loaded`);
      } else {
        console.log("Ollama: OFFLINE — Shadow AURA will be SUPPRESSED, not consulted");
      }
    });
  });

  // Wire up graceful shutdown handlers.
  setupGracefulShutdown(server);
}

main();
