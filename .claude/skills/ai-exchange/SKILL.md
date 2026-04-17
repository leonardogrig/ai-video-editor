---
name: ai-exchange
description: Use when the user asks to "check ai-exchange", "look at the ai-exchange folder/file", "fill in the noise threshold", "answer the pending video editor request", "set the threshold in the JSON", or otherwise refers to the `ai-exchange/` folder in this project. The UI writes JSON job files there; this skill fills in the `null` answer fields so the UI can consume them.
---

# ai-exchange

The video editor UI drops JSON request files into `ai-exchange/` at the project root. Each file represents one pending job waiting for your answer. Fill in the `null` fields according to the file's own `instructions`, save the file in place, and leave deletion to the UI.

## Workflow

1. List `ai-exchange/*.json` (Glob). There is usually at most one file — the "latest" — but handle multiple if present.
2. Read each file. Every job file has this shape:
   ```json
   {
     "task": "<job-name>",
     "createdAt": "<ISO timestamp>",
     "instructions": "<what to do>",
     "bounds": { ... },
     "<input fields>": ...,
     "<answer fields>": null
   }
   ```
3. Follow `instructions` verbatim. Respect `bounds`. Replace every `null` answer field with a concrete value.
4. Save with Edit — keep all other fields byte-identical. No reordering, no extra keys.
5. **Do not delete the file.** The UI deletes it on the next "Set from Response" click.
6. Tell the user briefly what you chose and why.

## Known tasks

### `noise-threshold`

Picks the dBFS noise threshold for silence removal.

#### What you get

- `summary` — one-sentence prose description of the audio distribution. Use this first; it's the distilled version of the stats.
- `mentalModel` — one of:
  - `bimodal-clean` — clear valley between noise and speech humps. The `valley` candidate usually wins.
  - `bimodal-soft` — two humps but the valley is shallow/broad. Quantile rules (`median`, `median-3`) usually beat `valley`.
  - `unimodal` — no clear separation; noise and speech overlap. Err toward the safer (quieter) end.
- `stats` — minimal percentiles: `durationSec`, `minDb`, `maxDb`, `p10Db`, `p25Db`, `medianDb`, `p75Db`, `p90Db`.
- `candidates` — 4–5 threshold proposals, each with simulated outcome:
  - `db` — the candidate threshold.
  - `rule` — how it was derived.
  - `speechPct` — rounded percent of the track kept as speech.
  - `segments` — how many speech segments the detector produces.
  - `avgSec` — average segment length.

#### Decision strategy

1. Read `summary` and `mentalModel`. Form a mental picture before looking at numbers.
2. Map `mentalModel` to a candidate family:
   - `bimodal-clean` → prefer `valley`. The structural argument is strong.
   - `bimodal-soft` → prefer `median` or `median-3`. Quantile rules are more robust when the valley is soft.
   - `unimodal` → prefer a conservative quantile (`p25` or `median`). Don't get clever.
3. Sanity-check `speechPct` against content type:
   - Lecture / monologue / tutorial: 55–75%.
   - Conversational podcast with pauses: 40–55%.
   - Continuous narration / dense talk: >75%.
   - Interview with long listener segments: 30–45%.
4. Reject candidates with pathological `segments` / `avgSec`:
   - Thousands of segments with tiny `avgSec` → threshold is fragmenting speech. Move quieter.
   - Tiny segment count with huge `avgSec` → threshold is glueing noise to speech. Move louder.
5. Tiebreaker between two reasonable candidates: **pick the quieter one**. Too-low keeps extra silence (user can trim with "Remove Silences Longer Than"). Too-high cuts real speech (unrecoverable).

#### When to go off-list

Only set a custom integer outside `candidates` if:
- The content description contradicts `mentalModel` (user told you "this is mostly music with speech over the top") AND
- You can name the rule you're applying and why it beats all listed candidates.

Explain your reasoning to the user in 1–2 sentences so they can sanity-check.

#### Note on calibration offset

The UI applies a **+10 dB calibration offset** when it consumes your answer (e.g. if you write −54, the slider ends up at −44). This is a standing user preference — don't try to compensate for it. Pick the structurally correct threshold; the UI will shift it.

## Extending

When a new `task` appears that isn't documented above, trust the file's own `instructions` field — it is the source of truth.
