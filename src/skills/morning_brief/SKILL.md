# Skill: Morning Brief

Sends a once-per-day summary: today's score, top concerns, next event.

**When:** between 06:30 and 08:00, once per day (gated).
**Importance:** normal — relies on PRISM gate to decide.
**Inputs:** CRS score breakdown, next calendar event.
**Output:** Telegram message (or console fallback).
**Also serves as:** the dashboard's score refresh source (dry_run tick recomputes only).
