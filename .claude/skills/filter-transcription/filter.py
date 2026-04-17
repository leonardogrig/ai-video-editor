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


def tokens(text: str) -> list[str]:
    return _PUNCT.sub(" ", text.lower()).split()


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


def cluster_segments(segments: list[dict]) -> list[list[int]]:
    """Group indices of `segments` into retake clusters (empty-text segs skipped).

    Each new segment joins an open cluster only if it is similar to that cluster's
    most recent member. Retake storms chain from the latest take, not from earlier
    ones — comparing against earlier members causes false merges when two distinct
    sentences share a long opening prefix.
    """
    clusters: list[list[int]] = []
    for i, seg in enumerate(segments):
        if not seg.get("text", "").strip():
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
    return clusters


def filter_segments(segments: list[dict]) -> tuple[list[dict], list[list[int]]]:
    clusters = cluster_segments(segments)
    # Pick the last member of each cluster, then restore chronological order.
    # (Clusters are emitted in order of first-member start, but the last member
    # of an earlier cluster can land after the first member of a later one.)
    kept_indices = sorted(c[-1] for c in clusters)
    kept = [
        {"start": segments[i]["start"],
         "end":   segments[i]["end"],
         "text":  segments[i]["text"]}
        for i in kept_indices
    ]
    return kept, clusters


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

    kept, clusters = filter_segments(segments)

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

    if verbose:
        debug = [
            {
                "size": len(c),
                "kept_start": segments[c[-1]]["start"],
                "members": [
                    {"start": segments[i]["start"], "end": segments[i]["end"], "text": segments[i]["text"]}
                    for i in c
                ],
            }
            for c in clusters
        ]
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
