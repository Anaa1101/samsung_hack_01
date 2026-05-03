# Skill: Commute Guardian

Watches the next calendar event vs. baseline commute time + weather. Decides whether to nudge
the user to leave earlier (rain, traffic, big buffer needed).

**When:** every 5 min during commute hours (07:00-09:30, 17:00-19:00).
**Importance:** high if next event < buffer + commute, normal otherwise.
**Inputs:** next event start, weather (Open-Meteo), historical commute baseline.
**Output:** Telegram message: "Leave in X min. Rain expected. Buffer 5 min."
