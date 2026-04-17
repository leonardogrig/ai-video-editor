---
name: filter-transcription
description: Use when the user asks to "filter the transcription", "clean up the transcript", "dedupe the transcription", "produce edited.json", "filter with Claude Code", or otherwise refers to editing the JSON in `public/transcriptions/`. Reads the single raw transcription file and writes a filtered `edited.json` next to it for the UI to import.
---

# filter-transcription

The video editor used to send the transcription to an LLM over OpenRouter for deduping. That API path is gone. Now you (Claude Code) do the filtering locally: read the raw JSON, clean it up, and save the result as `public/transcriptions/edited.json`. The UI then has an "Import from Claude Code" button that loads that file and feeds it into the editor as `filteredSegments`.

## Workflow

1. **Locate the raw transcription.** Glob `public/transcriptions/*.json`. There should be exactly one file that is *not* named `edited.json`. If `edited.json` already exists, ignore it (it's the previous run's output and will be overwritten). If you find zero or multiple raw files, stop and tell the user — the UI writes exactly one.

2. **Read the file.** It has this shape (from `app/api/transcription-cache/route.ts`):
   ```json
   {
     "fileName": "...",
     "fileSize": 123,
     "language": "english",
     "createdAt": "...",
     "segments": [
       { "start": 1.66, "end": 2.27, "text": "Thank you." },
       ...
     ]
   }
   ```

3. **Filter the `segments` array** using the rules below. Keep the order (chronological by `start`).

4. **Write `public/transcriptions/edited.json`** with this exact shape (a subset of the input — do not invent fields):
   ```json
   {
     "fileName": "<copy from input>",
     "language": "<copy from input>",
     "createdAt": "<new ISO timestamp, Date.now()>",
     "source": "filter-transcription skill",
     "originalCount": <number of input segments>,
     "filteredCount": <number of output segments>,
     "segments": [ { "start": ..., "end": ..., "text": "..." }, ... ]
   }
   ```

5. **Report to the user in 1–2 sentences**: how many segments removed, what kinds of duplicates you killed, anything surprising. Do not list every cut — they'll review in the UI.

## Filtering rules

The underlying problem: Whisper often re-transcribes the same phrase multiple times as its context window slides forward. You'll see near-identical `text` at increasing `start` times, usually with each later copy being longer/more complete than the earlier ones.

### Primary rule: keep the last occurrence of any repeated phrase — ALWAYS

If two or more adjacent (or near-adjacent) segments say essentially the same thing — even if rephrased, truncated, or punctuated differently — keep **only the last** one. **Always.** If a phrase is repeated 3 times, keep the 3rd. If 5 times, keep the 5th. No exceptions.

This rule holds even when the last take is **shorter, less complete, or less polished** than an earlier take. The speaker's final delivery is what gets kept — that's the take they committed to. Do not second-guess by scoring "completeness" and substituting an earlier take. Do not bend the rule to preserve content ("but the earlier one had the call-to-action!") — the speaker chose to drop it.

Only three narrow reasons override "keep the last":
1. The last segment's `text` is empty/whitespace-only (always drop empty segments).
2. The last segment is byte-identical to the one before it AND they're back-to-back (true stutter duplicate — pick either, prefer last).
3. The "last" candidate is actually a *different* sentence that only superficially shares words (see "What does NOT count as a duplicate" below) — in which case it isn't part of the cluster to begin with.

**Examples of duplicates to collapse:**
```
{ "start": 4.69,  "end": 8.9,   "text": "Hey there, it's Leo from Firecall and in this video we'll be taking a look at the new routines from" }
{ "start": 9.49,  "end": 13.34, "text": "Hey there's Leo from Firecrawl and in this video we'll be taking a look at the new routines from" }
{ "start": 14.41, "end": 18.8,  "text": "Hey there's Leo from Firecrawl and in this video, we'll be taking a look at the new routines inside of cloud code." }
{ "start": 20.02, "end": 23.9,  "text": "Hey there, it's Leo from Firecall, and in this video, we'll be taking a look at the new routines inside of" }
{ "start": 24.97, "end": 29.57, "text": "Hey there, it's Leo from Firecrawl. And in this video, we'll be taking a look at the new routines inside of Cloud Code." }
```
Keep only the last one (`24.97 → 29.57`). The earlier four are retakes of the same intro.

### What counts as "essentially the same"

- Same opening phrase (≥ ~60% word overlap) within a short window (≤ ~20s between starts).
- Minor rewording, added/dropped trailing words, filler swaps ("uh", "um"), punctuation changes.
- One segment being a prefix or truncation of a later, more complete one.

### What does NOT count as a duplicate

- Two sentences that happen to share a subject ("The model is fast." / "The model is accurate.") — different claims, keep both.
- Echoes from different parts of the video (the speaker legitimately repeats a point 5 minutes later) — keep both.
- "Thank you", "yeah", "okay" standalone fillers — unless they're stutter-repeats back-to-back, keep them; they often mark real beats.

### Secondary cleanup

- Drop segments with empty or whitespace-only `text`.
- Do **not** rewrite `text`. Do not merge segments. Only drop or keep.
- Do **not** alter `start` / `end` values.

## Edge cases

- **If the raw file has `segments: []` or is already clean** (no obvious dupes): write `edited.json` anyway, with the same segments. The UI needs the file to exist to import.
- **If the input shape is different** (e.g. a bare array instead of `{segments: [...]}`): handle both. Some older files may be bare arrays. Always write the output in the structured shape above.
- **Do not delete the raw file.** Only write `edited.json`.

## Self-review checklist (run before writing `edited.json`)

Walk through this list explicitly. If any item fails, revise your output before saving.

### 1. Readability — can you read the output as a script?
- [ ] Read the kept `text` fields top-to-bottom as if you were a subtitle reader. Does it flow like a coherent monologue / dialogue?
- [ ] No abrupt mid-sentence cuts that would leave a viewer confused (e.g. keeping a segment that ends "and then we..." with the next kept segment starting a new topic).
- [ ] No orphaned phrases left behind from a retake cluster (e.g. you kept the final long take but also an earlier truncated "Hey there, it's Leo..." — that fragment should have gone with its siblings).

### 2. Flow — does the timeline make sense?
- [ ] `start` values in the output are strictly increasing.
- [ ] No segment's `end` > the next segment's `start` (overlap). If you see one, the earlier segment is usually a retake that should have been dropped; reconsider.
- [ ] Gaps between segments are plausible (breath pauses, edits, beats). A suspicious 30-second gap between two normal sentences probably means you dropped a segment you shouldn't have.

### 3. Fidelity — did you actually leave the data untouched?
- [ ] Every kept segment's `start`, `end`, and `text` is **byte-identical** to its counterpart in the raw file. No rounding, no re-casing, no punctuation "fixes", no whitespace trimming.
- [ ] You only **dropped** segments. You did not **merge** two segments into one, split one into two, or rewrite text.
- [ ] No invented segments. Every output segment exists in the input.
- [ ] You used the `segments` array from the input — not the top-level `fileName` / `language` / `createdAt` fields mistaken for segment data.

### 4. Duplicate handling — did you apply the rule correctly?
- [ ] For each retake cluster: you kept **exactly one** segment, and it is the **last** (highest `start`) in the cluster. Always the last. Not the "most complete" — the **last**.
- [ ] You did not substitute an earlier take for the last one because you judged it more complete, cleaner, or because it contained content you liked. If the speaker's final take drops the call-to-action, the call-to-action is gone.
- [ ] You did not drop a segment just because it's similar to a distant one — duplicate collapsing applies within sliding retake windows, not across the whole video.
- [ ] Standalone fillers ("Thank you.", "Yeah.", "Okay.") are kept unless they are back-to-back stutter repeats.

### 5. Output shape
- [ ] Wrote to `public/transcriptions/edited.json` (not anywhere else, not with a different name).
- [ ] Output JSON parses. `segments` is an array. Each segment has `start` (number), `end` (number), `text` (string).
- [ ] `originalCount` equals the input segment count. `filteredCount` equals the output segment count. `filteredCount` ≤ `originalCount`.
- [ ] Did not delete or modify the raw input file.

### 6. Sanity check on aggressiveness
- [ ] If you removed **>50%** of segments, re-examine: likely over-cutting. The rule targets retake clusters, not general compression.
- [ ] If you removed **0** segments but the raw file clearly has retakes (look at the first 10–20 segments — any obvious repeats?), you were too timid. Try again.

Report the checklist result in one line to the user, e.g. "All checks passed; removed 47 of 312 segments, mostly intro retakes." Do not paste the whole checklist back.
