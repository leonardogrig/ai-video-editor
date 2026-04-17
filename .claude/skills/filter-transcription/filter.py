#!/usr/bin/env python3
"""Deterministic filter for the filter-transcription skill.

Reads the single raw *.json in public/transcriptions/ (anything not named edited.json),
groups Whisper retake clusters via token-level similarity on a sliding window, keeps the
LAST segment of every cluster, drops empty-text segments, and writes edited.json next to
the raw file. Prints a concise cluster report so the caller can spot-review.

Usage:
    python filter.py               # auto-locate raw in ./public/transcriptions/
    python filter.py path/to/raw.json
    python filter.py raw.json --verbose   # also write edited.clusters.json with every member
"""
from __future__ import annotations

import difflib
import json
import re
import sys
import time
from pathlib import Path

WINDOW_SECONDS = 20.0           # sliding retake window
RATIO_LONG = 0.6                # SequenceMatcher threshold for segs where max(len) > 5
RATIO_SHORT = 0.8               # tighter threshold for short segs to avoid collapsing
                                # legitimately different short sentences (e.g. "The X is fast"
                                # vs "The X is accurate")

_PUNCT = re.compile(r"[^\w\s]")
# Trailing dash / double-dash: Scribe marks either an abandoned fragment OR
# a speech-continues-in-next-segment. Distinguished by whether the next
# segment opens with a matching leading dash (continuation pair).
_DASH_TAIL = re.compile(r"(?:--+|[-\u2013\u2014])\s*$")
# Trailing ellipsis: consistently "speaker trailed off / abandoned".
_ELLIPSIS_TAIL = re.compile(r"(?:\.{2,}|\u2026)\s*$")
# Segment starts with a dash — signals "continuation of the previous
# cut-off segment".
_DASH_HEAD = re.compile(r"^\s*(?:--+|[-\u2013\u2014])")
# Standalone stage directions / sound tags like "(clears throat)",
# "[MUSIC]", "(laughs)". Scribe emits these as their own segment; they
# are not speech and shouldn't survive into the edit.
_ANNOTATION_ONLY = re.compile(r"^\s*[\(\[][^\)\]]*[\)\]]\s*$")
CONTINUATION_GAP_SECONDS = 6.0


def tokens(text: str) -> list[str]:
    return _PUNCT.sub(" ", text.lower()).split()


def _is_abandoned_dash(segments: list[dict], i: int) -> bool:
    """segment[i] ends with a dash — decide whether it's an abandoned retake
    (drop) or a continuation whose partner is the following segment (keep).

    The trailing dash is ambiguous in Scribe output: "FireCrawl-" + "--in
    combination with an app" is one utterance split in two; "To produce an
    in-" + "To produce a nearly infinite amount of blog posts." is a retake
    the speaker abandoned; "...blog p-" + "Post." is a mid-word split Scribe
    forgot to mark. Rules are tried in order.
    """
    j = i + 1
    if j >= len(segments):
        return True  # trailing dash at end of file — nothing to continue into
    nxt = segments[j]
    nxt_text = (nxt.get("text") or "").strip()
    if not nxt_text:
        return True
    if (nxt["start"] - segments[i]["end"]) > CONTINUATION_GAP_SECONDS:
        return True  # too much silence between — not a continuation
    # 1. Explicit continuation marker: next opens with a leading dash.
    if _DASH_HEAD.match(nxt_text):
        return False
    # 2. Retake storm or non-speech next: if the following segment is also
    # abandoned (trailing dash / ellipsis) or itself non-speech (annotation,
    # no word tokens), treat the current as abandoned too. Otherwise a
    # dash-fragment followed by "So..." or "(sighs)" would survive just
    # because the literal next segment isn't a clean word-completion.
    if _DASH_TAIL.search(nxt_text) or _ELLIPSIS_TAIL.search(nxt_text):
        return True
    if _ANNOTATION_ONLY.match(nxt_text) or not tokens(nxt_text):
        return True
    cur_tokens = tokens(segments[i]["text"])
    nxt_tokens = tokens(nxt_text)
    # 3. Explicit retake: first two tokens match ("To produce an in-" vs
    # "To produce a nearly infinite amount...").
    if len(cur_tokens) >= 2 and len(nxt_tokens) >= 2 and cur_tokens[:2] == nxt_tokens[:2]:
        return True
    # 4. Short abandoned fragment that shares just one opener ("But you-"
    # vs "But first..."). Only when current ≤ 3 tokens — otherwise we'd
    # false-positive on unrelated sentences that happen to share a word.
    if 1 <= len(cur_tokens) <= 3 and nxt_tokens and cur_tokens[0] == nxt_tokens[0]:
        return True
    # 5. Length test: a real word-completion continuation is always short
    # (≤ 2 tokens like "Post.", "the store."). If the following segment is
    # longer, it's a new sentence and the current fragment is abandoned.
    if len(nxt_tokens) > 2:
        return True
    # 6. Short next with no retake signal → assume continuation, keep pair.
    return False


def is_droppable(segments: list[dict], i: int) -> bool:
    """True when segment i is non-speech noise: empty, a standalone stage
    direction, an abandoned trailing-dash fragment, trailing ellipsis, or
    pure punctuation with no word characters."""
    text = (segments[i].get("text") or "").strip()
    if not text:
        return True
    if _ANNOTATION_ONLY.match(text):
        return True
    if _ELLIPSIS_TAIL.search(text):
        return True
    if _DASH_TAIL.search(text) and _is_abandoned_dash(segments, i):
        return True
    if not tokens(text):
        return True
    return False


def similar(a: str, b: str) -> bool:
    """True if a and b are plausibly takes of the same phrase.

    Rules (first one that fires wins):
      1. Shorter is an exact prefix of longer — definitive retake signal.
      2. Short fragment (≤3 tokens): 2-token opening agreement.
      3. Coverage: longest contiguous token block covers ≥80% of the shorter
         segment. Catches retakes where the speaker inserts/removes a word
         mid-phrase ("I specify…" → "I do specify…") without merging unrelated
         sentences that only share a long opening prefix ("For example, if I
         wanted to write about X" vs "For example, if I wanted to write about
         Y" — common block is large but covers <80% of each).
      4. Token-level SequenceMatcher.ratio() ≥ threshold (tighter for short).
    """
    wa, wb = tokens(a), tokens(b)
    if not wa or not wb:
        return False
    shorter, longer = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    s_len = len(shorter)
    if s_len <= 1:
        return False
    if longer[:s_len] == shorter:
        return True
    if s_len <= 3:
        return shorter[:2] == longer[:2]
    sm = difflib.SequenceMatcher(None, shorter, longer, autojunk=False)
    if s_len >= 5:
        match = sm.find_longest_match(0, s_len, 0, len(longer))
        if match.size / s_len >= 0.8:
            return True
    threshold = RATIO_SHORT if max(len(wa), len(wb)) <= 5 else RATIO_LONG
    return sm.ratio() >= threshold


def cluster_segments(segments: list[dict]) -> tuple[list[list[int]], list[int]]:
    """Partition segments into retake clusters plus a list of dropped-outright indices.

    Segments that are non-speech noise (empty, stage directions, abandoned
    fragments marked by trailing dash/ellipsis) are filtered *before* clustering
    so they never become the "last member" of a cluster and never influence
    similarity scoring. Everything else clusters normally; each new segment
    joins an open cluster only if it is similar to that cluster's most recent
    member. Retake storms chain from the latest take, not from earlier ones —
    comparing against earlier members causes false merges when two distinct
    sentences share a long opening prefix.
    """
    clusters: list[list[int]] = []
    dropped: list[int] = []
    for i, seg in enumerate(segments):
        if is_droppable(segments, i):
            dropped.append(i)
            continue
        joined = False
        for cluster in reversed(clusters):
            last = segments[cluster[-1]]
            if seg["start"] - last["start"] > WINDOW_SECONDS:
                break
            if similar(last["text"], seg["text"]):
                cluster.append(i)
                joined = True
                break
        if not joined:
            clusters.append([i])
    return clusters, dropped


def _sweep_orphan_continuations(
    segments: list[dict], kept_set: set[int], dropped: list[int]
) -> None:
    """Drop kept segments that are only meaningful as the tail half of a
    continuation pair whose head got dropped (e.g. "...blog p-" clustered
    away, leaving "Post." as an unreadable orphan). Mutates kept_set/dropped
    in place."""
    dropped_set = set(dropped)
    # A segment is "head-dropped" if its immediate predecessor within 6s
    # ends with a dash and is not in kept_set. An orphan tail is a short
    # kept segment that would be meaningless without that dropped head.
    for i in sorted(kept_set):
        if i == 0:
            continue
        prev = segments[i - 1]
        cur = segments[i]
        prev_text = (prev.get("text") or "").strip()
        cur_text = (cur.get("text") or "").strip()
        if not _DASH_TAIL.search(prev_text):
            continue
        if (i - 1) in kept_set:
            continue  # predecessor survived — pair is intact, leave the tail alone
        if (cur["start"] - prev["end"]) > CONTINUATION_GAP_SECONDS:
            continue
        # Only sweep very short tails (1–3 tokens). Longer ones are likely
        # their own statement, not a word-completion of the dropped head.
        if len(tokens(cur_text)) > 3:
            continue
        kept_set.discard(i)
        dropped_set.add(i)
    dropped[:] = sorted(dropped_set)


def filter_segments(
    segments: list[dict],
) -> tuple[list[dict], list[list[int]], list[int]]:
    clusters, dropped = cluster_segments(segments)
    # Pick the last member of each cluster, then restore chronological order.
    # (Clusters are emitted in order of first-member start, but the last member
    # of an earlier cluster can land after the first member of a later one.)
    kept_set: set[int] = {c[-1] for c in clusters}
    _sweep_orphan_continuations(segments, kept_set, dropped)
    kept_indices = sorted(kept_set)
    kept = [
        {"start": segments[i]["start"],
         "end":   segments[i]["end"],
         "text":  segments[i]["text"]}
        for i in kept_indices
    ]
    return kept, clusters, dropped


SKIP_NAMES = {"edited.json", "edited.clusters.json"}


def locate_raw(base: Path) -> Path:
    tdir = base / "public" / "transcriptions"
    if not tdir.exists():
        raise SystemExit(f"Not found: {tdir}")
    candidates = [p for p in tdir.glob("*.json") if p.name not in SKIP_NAMES]
    if len(candidates) == 0:
        raise SystemExit(f"No raw transcription in {tdir}")
    if len(candidates) > 1:
        names = ", ".join(p.name for p in candidates)
        raise SystemExit(f"Multiple raw files in {tdir}: {names}. Expected exactly one.")
    return candidates[0]


def main() -> None:
    args = sys.argv[1:]
    verbose = "--verbose" in args
    args = [a for a in args if not a.startswith("--")]

    if args:
        raw_path = Path(args[0]).resolve()
    else:
        raw_path = locate_raw(Path.cwd())

    raw = json.loads(raw_path.read_text())
    if isinstance(raw, list):
        segments = raw
        meta = {"fileName": raw_path.name, "language": "english"}
    else:
        segments = raw["segments"]
        meta = raw

    kept, clusters, dropped = filter_segments(segments)

    out = {
        "fileName":      meta.get("fileName", raw_path.name),
        "language":      meta.get("language", "english"),
        "createdAt":     time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "source":        "filter-transcription skill",
        "originalCount": len(segments),
        "filteredCount": len(kept),
        "segments":      kept,
    }
    out_path = raw_path.parent / "edited.json"
    out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False))

    removed = len(segments) - len(kept)
    pct = (removed / len(segments) * 100) if segments else 0.0
    print(f"Input:  {len(segments)} segments")
    print(f"Output: {len(kept)} segments ({removed} dropped, {pct:.1f}%)")
    print(f"  · {len(dropped)} non-speech / abandoned fragments dropped outright")
    print(f"  · {removed - len(dropped)} collapsed into retake clusters")
    print(f"Wrote:  {out_path}")

    retakes = [c for c in clusters if len(c) > 1]
    if retakes:
        print(f"\nRetake clusters: {len(retakes)}")
        for c in sorted(retakes, key=lambda c: -len(c))[:20]:
            span0 = segments[c[0]]["start"]
            span1 = segments[c[-1]]["end"]
            txt = segments[c[-1]]["text"]
            txt = (txt[:80] + "…") if len(txt) > 80 else txt
            print(f"  {len(c):2}× [{span0:7.2f}-{span1:7.2f}] kept@{segments[c[-1]]['start']:.2f}: {txt}")
        if len(retakes) > 20:
            print(f"  … and {len(retakes)-20} smaller clusters")

    if dropped and verbose:
        print(f"\nDropped outright ({len(dropped)}):")
        for i in dropped[:20]:
            s = segments[i]
            txt = (s["text"][:80] + "…") if len(s["text"]) > 80 else s["text"]
            print(f"  [{s['start']:7.2f}-{s['end']:7.2f}] {txt}")
        if len(dropped) > 20:
            print(f"  … and {len(dropped)-20} more")

    if verbose:
        debug = {
            "clusters": [
                {
                    "size": len(c),
                    "kept_start": segments[c[-1]]["start"],
                    "members": [
                        {"start": segments[i]["start"], "end": segments[i]["end"], "text": segments[i]["text"]}
                        for i in c
                    ],
                }
                for c in clusters
            ],
            "dropped": [
                {"start": segments[i]["start"], "end": segments[i]["end"], "text": segments[i]["text"]}
                for i in dropped
            ],
        }
        # Write next to this script — keep the public/transcriptions/ dir clean
        # so the UI and the skill's own glob don't trip over a stray file.
        dbg_path = Path(__file__).resolve().parent / "last-run.clusters.json"
        dbg_path.write_text(json.dumps(debug, indent=2, ensure_ascii=False))
        print(f"Debug:  {dbg_path}")

    if pct > 70:
        print(f"\nNOTE: {pct:.1f}% removed. Review the large clusters above for false merges.")
    elif pct < 5 and len(segments) > 50:
        print(f"\nNOTE: only {pct:.1f}% removed. If the raw has obvious retakes, review.")


if __name__ == "__main__":
    main()
