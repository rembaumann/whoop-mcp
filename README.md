# whoop-mcp

**Whoop Coach MCP** — check whether recovery is in the expected band, debug when it isn't, then recommend what to do with today's session.

One thing I have struggled with Whoop is using the context of the rest of my life to make judgments. It does not know my planned workouts ahead of time. Sometimes I will intentionally go out and have drinks, even though it impacts my recovery score. Most Whoop MCPs dump recovery, sleep, and strain into an agent. This one runs a tighter loop:

1. **In band?** Is recovery (and supporting metrics) where we'd expect given intents + recent load?
2. **If not, debug.** Rank plausible causes (logged lifestyle, under-recorded strain, niggle, or unexplained).
3. **Then plan today.** Go / go lighter / swap / rest, with a concrete alternate for heavy days.

Built for active people who use personal AI assistants and want more deterministic decisions around their program — especially people who lose progress when they push into unexplained crashes or treat every bad recovery score the same.

## Status

| Stage | What's in | State |
|---|---|---|
| **v0 (current)** | Intent log, recovery in-band / debug, training call | Spec locked; implementation not started |
| **v1 (planned)** | Reconcile workouts in Google Sheets/Drive with Whoop (catch missing strain) | Spec only |
| **v2 (planned)** | Session effort vs expected (trainer days vs solo) | Spec only |
| **Later** | Calendar load as context; smarter journal assists | Ideas |

## Non-goals (v0)

- Not a thin 1:1 wrapper of every Whoop v2 endpoint
- No medical **diagnosis** ("you are sick"). Hypothesis lists that include possible illness as one unchecked cause are OK
- No reverse-engineered / unofficial Whoop write APIs
- No calendar sync yet
- No replacing Whoop's journal UI end-to-end
- No Sheets sync or trainer-vs-solo effort scoring yet (see Next)

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

Answer: was this recovery day **in the expected band**? If not, debug why.

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
- `hypotheses` (when `unexplained`): ordered plausible causes to check, e.g. under-logged strain, unlogged alcohol, possible illness-shaped pattern, sensor/sleep quality gap
- `missing`: what could not be read (scopes, gaps, API errors)

**Rules**
- Matching intent + metrics consistent with it → `expected`
- Metrics materially off baseline + no matching intent → `unexplained` (hero path: debug)
- Whoop data missing → `insufficient_data`, never guess
- Do **not** diagnose ("you are sick"). Do **list** unchecked hypotheses, which may include possible illness as one item among others

---

### `today_training_call`

Use the in-band / debug result to recommend today's session.

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
- Heavy squat / deadlift / bench + `unexplained` → prefer `go_lighter`, `swap`, or `rest` (never silent `go`)
- Heavy session + `expected` dip after logged drinks/late night → default `go_lighter`, not panic `rest`, unless readiness is severely low or a relevant niggle is open
- Relevant open niggle (e.g. knee + squat) → bias against loading that pattern
- Always give a concrete alternate when the call is not `go`

## Next (planned, not v0)

### v1 — Workout reconcile (Sheets ↔ Whoop)
- Read workouts from Google Sheets / Drive (personal training log)
- Diff against Whoop-recorded workouts
- Flag possible **missing / under-recorded strain** as a first-class debug hypothesis when recovery is unexplained
- Optional later: assist syncing Sheet entries into Whoop for more accurate strain

### v2 — Session effort vs expected (trainer vs solo)
- Tag sessions `with_trainer` | `solo`
- Compare strain / HR / calories to expected band for that session type
- Use trainer days as the high-effort baseline; coach solo days without shaming planned light days

### Later
- Calendar load (meetings, travel) as context
- Smarter journal / auto-suggest tags

## Auth

Official Whoop Developer API OAuth only. Local token storage. Document required scopes for recovery, sleep, and cycle/strain data.

## Evals

See [`evals/cases.md`](evals/cases.md). v0 is not done until the fixture suite passes.

## Example prompts

- "I had drinks last night — log that."
- "Was yesterday's recovery in band? If not, why?"
- "Today is heavy squat Day 4. What should I do?"

## Install

<!-- Fill after implementation -->

## Demo

<!-- Add GIF after first working run -->

## License

MIT
