# Skill: Meeting Reminder

Fires when any calendar event is starting within the next ~10 minutes. Goes through
the PRISM gate (so it stays silent if the user is already prepping or in DND) and
through the Adversary (so it won't double-nudge if AURA spoke recently).

**When:** every 3 min, all day.
**Importance:** scales with proximity — `high` if <5 min, `normal` if 5-10 min.
**Inputs:** next calendar event, current score.
**Output:** Telegram + voice: "Design review in 4 minutes."
