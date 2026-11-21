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
| **v0 (current)** | Intent log, recovery in-band / debug, training call, read-only cycle step count | v0 runnable (10/10 fixture evals; step counts covered by unit tests) |
| **v1 (planned)** | Reconcile workouts in Google Sheets/Drive with Whoop (catch missing strain) | Spec only |
| **v2 (planned)** | Session effort vs expected (trainer days vs solo) | Spec only |
| **Later** | Calendar load as context; smarter journal assists | Ideas |

## Non-goals (v0)

- Not a thin 1:1 wrapper of every Whoop v2 endpoint
- No medical **diagnosis** ("you are sick"). Hypothesis lists that include possible illness as one unchecked cause are OK
- No reverse-engineered / unofficial Whoop write APIs
- No writes to Whoop data (no POST, PUT, or DELETE of cycles, journal entries, or workouts)
- No body-measurement reads (`read:body_measurement` is not requested)
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

---

### `get_steps`

Read cycle step counts. Read-only. Does not change recovery or training calls.

**Input**
- `days` (optional integer 1–30, default 14): how many local dates of **completed** cycles to include, ending today in `WHOOP_TIMEZONE`

**Data used**
- `GET /v2/cycle` only (the collection this server already uses for strain). Each record's top-level `step_count` is the field WHOOP added on September 23, 2026. The [official Cycle schema](https://api.prod.whoop.com/developer/doc/openapi.json) types it as a nullable integer on the cycle, not inside `score`. `GET /v2/cycle/{cycleId}` returns the same record shape; this tool reads the collection.
- Authorized by the existing `read:cycles` scope. No new scope and no reconnect.
- A cycle runs wake-to-wake. Totals will not match a midnight-to-midnight pedometer. The open cycle has no `end`.

**Output**
- `current`: the open cycle. `coverage` is `partial`. `step_count_label` is `"<n> so far"` when steps exist, or `"not available"` when they do not. `start` is when that count began. `note` says the value updates during the day and is not a finished total. `current` itself is `null` when Whoop did not return an open cycle.
- `recent`: completed cycles in the window, oldest first. `coverage` is `complete`. `date` is the local wake date of `end` (the cycle's `timezone_offset`).
- `baseline_step_count`: mean of completed cycles in the window that have a numeric `step_count`.
- `baseline_cycles_counted` / `baseline_cycles_omitted`: how many completed cycles were in that mean, and how many were left out.
- `null_step_count`: the literal `not available`.
- `missing`: request errors. An error is not a step count of 0.

**Null vs zero**
- JSON `null`, a missing `step_count`, or a non-number is **not available**. It is stored as `step_count: null` and `step_count_label: "not available"`. It is not coerced to 0 (`Number(null)` is 0; this server does not do that).
- Those cycles are omitted from `baseline_step_count`. If every completed cycle is missing steps, the baseline is `null`, not 0.
- The open cycle's partial count is not included in the baseline.
- A numeric `0` is a real zero and is included in the baseline.

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

Official Whoop Developer API OAuth only ([authorization](https://api.prod.whoop.com/oauth/oauth2/auth), [token](https://api.prod.whoop.com/oauth/oauth2/token)). Local token storage under `~/.whoop-mcp/tokens.json` (mode `0600`). No unofficial Whoop APIs.

Required environment variables (see `.env.example`; `.env` is gitignored):

| Variable | Purpose |
|---|---|
| `WHOOP_CLIENT_ID` | Client ID from the Whoop developer dashboard |
| `WHOOP_CLIENT_SECRET` | Client secret. Never commit this |
| `WHOOP_REDIRECT_URI` | Redirect saved on the Whoop app. Local default `http://localhost:8080/callback` |
| `WHOOP_TIMEZONE` | Optional IANA zone for "today" / "yesterday" (else `TZ`, else `UTC`) |
| `WHOOP_DATA_DIR` | Optional. Defaults to `~/.whoop-mcp` |

Scopes requested: `read:recovery`, `read:sleep`, `read:cycles`, and `offline` (refresh token). Those cover recovery score, HRV, resting heart rate, sleep performance, cycle strain, and cycle `step_count`. Step count uses `read:cycles`; do not add a scope and do not reconnect for it. `log_intent` does not call Whoop. No tool writes to Whoop.

## Evals

See [`evals/cases.md`](evals/cases.md). Fixture translation: [`evals/fixtures/cases.json`](evals/fixtures/cases.json). `npm test` runs the 10 cases plus the drinks → explain → heavy-squat smoke path. It does not call Whoop.

## Example prompts

- "I had drinks last night — log that."
- "Was yesterday's recovery in band? If not, why?"
- "Today is heavy squat Day 4. What should I do?"
- "How many steps so far today, and what were the last few cycles?"

## Install

Node 20+. Create an app at [developer.whoop.com](https://developer.whoop.com). On that app, add this Redirect URI and save:

`http://localhost:8080/callback`

Whoop compares it character for character. `localhost` and `127.0.0.1` do not match, and a trailing slash does not match. If the dashboard already has a different URI, put that exact value in `WHOOP_REDIRECT_URI` instead.

```bash
npm install
npm run build
cp .env.example .env   # fill WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI
npm run auth           # browser login; tokens stay in ~/.whoop-mcp
```

If the browser says the `redirect_uri` is not a pre-registered redirect URL, the dashboard value and `WHOOP_REDIRECT_URI` still differ. `npm run auth` prints the URI it is sending.

The stdio server is `node dist/index.js`. Put the same env vars on the MCP process (Cursor may not use the repo `.env` as its cwd). Run `npm run auth` once in a terminal before asking an agent for recovery data.

### Claude Desktop

`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/absolute/path/to/whoop-mcp/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret",
        "WHOOP_REDIRECT_URI": "http://localhost:8080/callback",
        "WHOOP_TIMEZONE": "America/New_York"
      }
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in the project, or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["/absolute/path/to/whoop-mcp/dist/index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret",
        "WHOOP_REDIRECT_URI": "http://localhost:8080/callback",
        "WHOOP_TIMEZONE": "America/New_York"
      }
    }
  }
}
```

Do not commit real client secrets in either file.

## Demo

<!-- Add GIF after first working run -->

## License

MIT
