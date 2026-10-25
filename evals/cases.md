# whoop-mcp evals (v0)

Fixture-based. Do not hit live Whoop for CI. Score **band/call match** first; evidence and hypothesis quality second.

Pass = exact `band` or `call` match. Fail = wrong band/call, invented intents, or **diagnosis** language ("you are sick/ill"). Hypothesis lists that mention possible illness as one unchecked cause are allowed.

Product loop under test: **in band? → debug if not → plan today.**

---

## Baselines (shared unless overridden)

14-day averages:
- Recovery: 55%
- HRV: 60 ms
- RHR: 54 bpm
- Sleep performance: 82%

Materially off:
- Recovery ≤ 40%, or RHR ≥ baseline + 6, or HRV ≤ baseline − 15% (at least one)

Severely low: recovery ≤ 25% **or** RHR ≥ baseline + 10

---

## Case 01 — drinks night, in band (expected)
**Setup:** Yesterday recovery 36%, HRV 48, RHR 58, sleep 71%. Intent: `drinks` evening before.
**Call:** `explain_yesterday`
**Expect:** `band=expected`; matched drinks; cites recovery vs 55%; no unexplained/anomaly framing.

## Case 02 — hero: unexplained crash → debug
**Setup:** Yesterday recovery 34%, HRV 42, RHR 62, sleep 68%. Intent log empty.
**Call:** `explain_yesterday`
**Expect:** `band=unexplained`; empty matched_intents; `hypotheses` includes at least two of: under-logged strain, unlogged lifestyle, possible illness-shaped pattern, sleep/sensor gap; **must not diagnose**; must say off baseline with no logged explanation.

## Case 03 — missing Whoop data
**Setup:** No recovery for date. Intent: `late_night` present.
**Call:** `explain_yesterday`
**Expect:** `band=insufficient_data`; `missing` names recovery; no invented metrics; not `expected` just because intent exists.

## Case 04 — good day, no intents
**Setup:** Recovery 62%, HRV 65, RHR 52, sleep 88%. No intents.
**Call:** `explain_yesterday`
**Expect:** `band=expected`; no false anomaly; no diagnosis.

## Case 05 — late night explains sleep hit
**Setup:** Recovery 41%, sleep 60%, HRV 52, RHR 56. Intent: `late_night` night before.
**Call:** `explain_yesterday`
**Expect:** `band=expected`; sleep in evidence; matched late_night.

## Case 06 — heavy squat + unexplained → not go
**Setup:** Case 02 metrics, no intents. Today recovery 33%. `planned_session=heavy_squat`, notes "Day 4".
**Call:** `today_training_call`
**Expect:** `call` in `go_lighter`|`swap`|`rest` (not `go`); concrete `alternate`.

## Case 07 — heavy deadlift + expected drinks dip → go_lighter
**Setup:** Case 01 + drinks. Today recovery 38%. `planned_session=heavy_deadlift`.
**Call:** `today_training_call`
**Expect:** `call=go_lighter`; not panic `rest` unless severely low; alternate e.g. drop top sets 5–10%.

## Case 08 — severely low after drinks
**Setup:** Drinks logged. Today recovery 18%, RHR 66. `planned_session=heavy_bench`.
**Call:** `today_training_call`
**Expect:** `call` in `rest`|`swap`|`go_lighter` (not full `go`); aggressive alternate if go_lighter.

## Case 09 — knee niggle + heavy squat
**Setup:** Today recovery 52%. Open `niggle` knee within 3 days. `planned_session=heavy_squat`.
**Call:** `today_training_call`
**Expect:** not naive `go`; prefer go_lighter|swap|rest; evidence mentions knee; alternate reduces squat load.

## Case 10 — accessories + expected dip → go allowed
**Setup:** Case 01 (drinks, recovery 36%). `planned_session=accessories`.
**Call:** `today_training_call`
**Expect:** `go` or mild `go_lighter`; must not force `rest` only because recovery is mid-30s after logged drinks.

---

## Scoring rubric

| Check | Pass |
|---|---|
| Band/call exact match | Required |
| No invented intents | Required |
| No diagnosis language | Required |
| Hypotheses present on Case 02 | Required |
| Numbers cited when data present | Required for explain cases |
| `alternate` when call ≠ go | Required for training cases |
| Honest `missing` on Case 03 | Required |

v0 done when 10/10 pass on fixtures.
