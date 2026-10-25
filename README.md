# whoop-mcp

**Whoop Coach MCP** — an MCP server that explains recovery in context and protects heavy training days.

One thing I have struggled with Whoop is using the context of the rest of my life in order to make judgements. It does not know my planned workouts ahead of time. Sometime, I will intentionally go out and have drinks, even though it impacts my recovery score. Most Whoop MCPs dump recovery, sleep, and strain into an agent. This one answers three questions:

1. What did I intentionally do that should change how we read recovery?
2. Why does yesterday look the way it does?
3. Given today's planned session, should I go, go lighter, swap, or rest?

Built for active people who user personal AI assistants and want more deterministic ways of making decisions around their program, who traditionally miss progress when they push into unexplained crashes or treat every bad recovery score the same.

## Non-goals (v0)

- Not a thin 1:1 wrapper of every Whoop v2 endpoint
- No medical diagnosis or "you are sick" claims
- No reverse-engineered / unofficial Whoop write APIs
- No calendar sync yet (planned later)
- No replacing Whoop's journal UI end-to-end

## Tools (v0 contract)

### `log_intent`

Record a lifestyle or training context event so later explanations are not naive.

**Input**
- `date` (YYYY-MM-DD, default: today in user timezone)
- `type`: `drinks` | `late_night` | `travel` | `hard_life` | `hard_training` | `niggle` | `other`
- `note` (optional string)
- `body_area` (optional; required when `type` is `niggle`, e.g. `knee`, `shoulder`)

**Output**
- Confirmation of stored intent
- Count of intents on that date

**Rules**
- Local store only (JSON or SQLite). Do not write back into Whoop in v0.
- Multiple intents per day allowed.
- Never invent an intent the user did not log.

---

### `explain_yesterday`

Explain the latest completed recovery day using physiology + intents.

**Input**
- `date` (optional; default: yesterday in user timezone)

**Data used**
- Whoop recovery, resting HR / HRV (as available), sleep performance for that day
- ~14-day personal baselines for the same metrics
- Intent log for that date (and optionally the evening before for `drinks` / `late_night`)

**Output (required fields)**
- `band`: `expected` | `unexplained` | `insufficient_data`
- `summary`: 1–3 sentences
- `evidence`: list of metric deltas vs baseline (cite numbers)
- `matched_intents`: intents that plausibly explain the dip
- `missing`: what could not be read (scopes, gaps, API errors)

**Rules**
- If a matching intent exists and metrics are consistent with it → `expected`
- If metrics are materially off baseline and no matching intent → `unexplained` (anomaly signal)
- If Whoop data is missing → `insufficient_data`, never guess
- Do not say "you are getting sick." Say physiology looks anomalous relative to baseline and logged context.

---

### `today_training_call`

Recommend what to do with today's planned session.

**Input**
- `planned_session`: `heavy_squat` | `heavy_deadlift` | `heavy_bench` | `accessories` | `light` | `rest`
- `optional_notes` (e.g. "Day 4", "knee tingled yesterday")

**Data used**
- Today's recovery / readiness (or most recent)
- `explain_yesterday` result for context
- Open `niggle` intents in the last 7 days relevant to the session
- Intent log for last night / today

**Output (required fields)**
- `call`: `go` | `go_lighter` | `swap` | `rest`
- `rationale`: short, cited
- `alternate` (required when not `go`): concrete prescription, e.g.
  - "Drop top sets 5–10% on the main; keep accessories"
  - "Swap Day 4 and Day 5; do bench today if that was Day 5"
  - "Skip heavy squat; replace with technique work at ≤60%"
- `evidence` + `missing`

**Rules**
- Heavy squat / deadlift / bench + `unexplained` anomaly → prefer `go_lighter`, `swap`, or `rest` (never silent `go`)
- Heavy session + `expected` dip after logged drinks/late night → default `go_lighter`, not panic `rest`, unless readiness is severely low or a relevant niggle is open
- Relevant open niggle (e.g. knee + squat) → bias against loading that pattern
- Always give a concrete alternate when the call is not `go`

## Auth

Official Whoop Developer API OAuth only. Local token storage. Document required scopes for recovery, sleep, and cycle/strain data.

## Evals

See `evals/` (coming next). v0 is not done until the fixture suite passes the bands above.

## Example prompts

- "I had drinks last night — log that."
- "Explain yesterday's recovery."
- "Today is heavy squat Day 4. What should I do?"

## Install

<!-- Fill after implementation: Claude Desktop / Cursor MCP config snippet -->

## Demo

<!-- Add GIF of today_training_call after first working run -->

## License

MIT