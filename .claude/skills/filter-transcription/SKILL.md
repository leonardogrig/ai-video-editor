---
name: filter-transcription
description: Use when the user asks to "filter the transcription", "clean up the transcript", "dedupe the transcription", "produce edited.json", "filter with Claude Code", or otherwise refers to editing the JSON in `public/transcriptions/`. Reads the single raw transcription file and writes a filtered `edited.json` next to it for the UI to import.
---

# filter-transcription

The video editor used to send the transcription to an LLM over OpenRouter for deduping. That API path is gone. Now a deterministic Python helper in this skill folder (`filter.py`) does the work locally in under a second, and you (Claude Code) review the output.

## Workflow

1. **Run the helper** from the project root:
   ```bash
   python3 .claude/skills/filter-transcription/filter.py
   ```
   It auto-locates the single non-`edited.json` file inside `public/transcriptions/`, clusters Whisper retakes via token-level similarity on a 20-second sliding window, keeps the **last** segment of every cluster, drops empty-text segments, and writes `public/transcriptions/edited.json` next to the raw file. Runtime is ~0.1s.

2. **Read the printed cluster report.** It shows two totals (non-speech dropped outright vs. collapsed into retake clusters) and lists the 20 largest retake clusters with `size × [span] kept@start: <kept text>`. Scan for anything suspicious:
   - **Two distinct sentences merged into one cluster.** Symptom: the kept text of a large cluster doesn't share obvious opening words with earlier retake victims — e.g. the cluster spans two unrelated "For example" beats that just happen to share a prefix.
   - **Retakes that weren't clustered.** Symptom: successive kept segments in `edited.json` that say almost the same thing, 2–15s apart. Usually happens when the speaker restarts with very different opening words ("Now just bear in mind…" → "But first, have in mind…").
   - **Orphaned continuations.** Symptom: a kept segment starts with `--` or a sentence fragment ("Post.", "Blog.") that reads as the tail of a dropped abandoned predecessor. The upstream segment was abandoned without Scribe marking it as a continuation pair; either accept the orphan or restore the predecessor by editing `edited.json`.
   - **Hallucinated fillers.** Isolated "Thank you." / "Yeah." segments inside long silences. The helper keeps them (they're not clustered); drop in the UI or hand-edit if obviously artifacts.

3. **Fix anything wrong by editing `edited.json` directly** (it's small). To split a wrongly-merged cluster: add the missing segment(s) from `raw.json` back in, preserving byte-exact `start`/`end`/`text`, and keep the array sorted by `start`. To drop an extra: remove the segment. Update `filteredCount` to match.

   If you need to see the full membership of every cluster, re-run with `--verbose`:
   ```bash
   python3 .claude/skills/filter-transcription/filter.py --verbose
   ```
   which also writes `last-run.clusters.json` inside the skill folder (kept out of `public/transcriptions/` so the UI's own glob doesn't trip over it).

4. **Report to the user in 1–2 sentences**: the original→filtered counts, anything notable about the cuts (size of the largest retake cluster, any manual fixes you applied). Don't paste the cluster list — they'll review in the UI.

## The rules the helper enforces

### 1. Drop non-speech segments outright (before clustering)

A segment is dropped on sight when any of these hits:

- **Empty / whitespace-only text.**
- **Standalone stage direction** — entire text wrapped in parens or brackets: `(clears throat)`, `[MUSIC]`, `(laughs)`, `[Inaudible]`. Scribe emits these as their own segment; Whisper-on-Groq emits fewer of them but the rule covers both.
- **Trailing ellipsis** (`...` or `…`) — consistently means the speaker trailed off / abandoned the take.
- **Trailing dash** (`-`, `--`, `–`, `—`) when classified as abandoned. The trailing dash is ambiguous in ASR output — it can mark either (a) an abandoned fragment or (b) speech that continues in the next segment. The next segment within 6s is inspected to decide (tried in order):
    1. Next opens with a leading dash → continuation pair, **keep both**.
    2. Next is itself non-speech (ends with dash/ellipsis, is an annotation, or has no word tokens) → retake storm, **drop current**.
    3. Next opens with the same two tokens as current → explicit retake, **drop current**.
    4. Current ≤ 3 tokens and shares first token with next → short abandoned fragment, **drop current**.
    5. Next has > 2 word tokens → new sentence, current is abandoned, **drop current**.
    6. Otherwise (short next, no retake signal) → continuation pair, **keep both**.
- **Punctuation-only text** — no word characters survive tokenization.

### 1b. Sweep orphaned continuations after clustering

After clustering, if a short (≤ 3 tokens) kept segment sits immediately after a dash-ending segment that got dropped (by the rules above *or* by clustering into a later retake), the kept tail is swept too. Prevents orphans like stray `"Post."` / `"Mm-hmm."` when their `...blog p-` head gets absorbed into a later, fully-worded retake.

### 2. Primary rule: keep the last occurrence of any retake — ALWAYS

After the non-speech segments are removed, remaining segments go through cluster detection. If a phrase is repeated 3 times, keep the 3rd. If 5 times, keep the 5th. Even when the last take is *shorter* or *less polished* than an earlier one — that's the take the speaker committed to. Never substitute an earlier take because you judge it more complete.

The only override: the "last" candidate is actually a *different* sentence that only superficially shares words — in which case the helper correctly didn't cluster it in the first place.

## How the helper clusters (for debugging false merges / misses)

- **Window**: 20 seconds between a new segment's `start` and the most recent cluster member's `start`. Outside the window → new cluster.
- **Similarity** (between the new segment and the cluster's most recent member — not earlier members):
  1. Shorter is an exact token-prefix of the longer → match.
  2. Shorter ≤ 3 tokens and first 2 tokens agree → match (catches truncated fragments like "For example," / "Now, before me...").
  3. Shorter ≥ 5 tokens and longest contiguous block covers ≥ 80% of the shorter → match (catches "I specify where my project" ⊂ "I do specify where my project is, since…").
  4. `SequenceMatcher.ratio()` ≥ 0.6 (≥ 0.8 if both are ≤ 5 tokens) → match.
- Tokenization lowercases and strips punctuation. `"Firecrawl."` and `"firecrawl,"` tokenize the same.

Knobs in `filter.py`: `WINDOW_SECONDS`, `RATIO_LONG`, `RATIO_SHORT`, `CONTINUATION_GAP_SECONDS`. Tune only if a whole class of retakes is systematically missed — single edge cases are faster to patch by hand-editing `edited.json`.

## Edge cases

- **Raw file has `segments: []` or is already clean.** The helper still writes `edited.json` — the UI needs it to exist.
- **Input is a bare array** instead of `{segments: […]}`. The helper handles both; output is always the structured shape.
- **Zero or multiple raw files** in `public/transcriptions/` (other than `edited.json`). The helper errors out. Stop and ask the user which to use.
- **Do not delete the raw file.** Only `edited.json` is written.

## Self-review checklist

The helper already guarantees points 1–4 below. You only need to review 5–6.

1. Output JSON parses; `segments` is chronological; no overlaps. *(helper)*
2. Every kept segment is byte-identical to its counterpart in the raw. No merging, splitting, or rewriting. *(helper)*
3. `originalCount`/`filteredCount` are correct and `filteredCount ≤ originalCount`. *(helper)*
4. Raw input file untouched. *(helper)*
5. **Cluster report looks reasonable**: no obvious false merges (two distinct topics collapsed) and no obvious misses (the raw clearly has retakes for a phrase that has no cluster).
6. **Read the kept `text` top-to-bottom** as if you were a subtitle reader. Does it flow? Abrupt topic jumps are fine; dangling retake fragments (e.g. the kept text is a truncated "And then after reading through it, you can either" with no continuation) are fine — that's what the speaker actually said last.

Report the result in one line, e.g. "Filtered 638 → 330 segments in 0.1s; 88 retake clusters, largest 14× at 686–732s; no manual fixes needed."
