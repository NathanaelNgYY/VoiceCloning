#!/usr/bin/env python3
"""Flag words GPT-SoVITS will pronounce by NEURAL GUESS instead of the dictionary.

Any word not in the CMU / fast / hot dictionaries is handed to g2p_en's neural
predictor, which is *deterministically* wrong for most scientific / medical terms
(the "cohesin"->"cohesion" class of error). Those words come out wrong the same way
every time, and no re-roll or re-seed fixes them — only a hard ARPAbet override in
engdict-hot.rep does. This script reports exactly which words in a passage fall through
to that predictor, so an admin can add overrides before a demo instead of discovering
them by ear.

It reuses the LIVE g2p (text.english) so its verdict matches what the running inference
server actually does — including every override already in engdict-hot.rep.

Usage (run from the GPT-SoVITS root, e.g. ~/gpt-sovits-v2pro):
    python scan_oov_words.py < passage.txt
    echo "The cohesin complex ..." | python scan_oov_words.py
    python scan_oov_words.py --arpabet passage.txt   # also print the guessed ARPAbet

Exit code is 0 always; the report goes to stdout. Words already covered by the
dictionary are NOT listed (they are safe).
"""

import argparse
import re
import sys


def load_g2p():
    # english.py lives under GPT_SoVITS/text; support running from the SoVITS root
    # or from inside GPT_SoVITS.
    for p in ("GPT_SoVITS", ".", "GPT_SoVITS/text"):
        if p not in sys.path:
            sys.path.insert(0, p)
    from text.english import _g2p, text_normalize  # noqa: E402
    return _g2p, text_normalize


def is_covered(g2p, word):
    """True when the word is resolved from a dictionary, not the neural predictor.

    Mirrors en_G2p.qryword's dictionary lookups (CMU/hot + name dict) without invoking
    predict(). Short OOV words (<=3 chars) are read letter-by-letter, which is a
    deterministic spelling read, not a neural guess, so they are treated as covered.
    """
    w = word.lower()
    if len(w) <= 1:
        return True
    if w in g2p.cmu:
        return True
    if word.istitle() and w in g2p.namedict:
        return True
    if len(w) <= 3:
        return True  # letter-by-letter spell read, deterministic
    # possessive: covered iff the stem is covered
    m = re.match(r"^([a-z]+)'s$", w)
    if m:
        return is_covered(g2p, m.group(1))
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", help="text file to scan; stdin if omitted")
    ap.add_argument("--arpabet", action="store_true",
                    help="also print the neural-guessed ARPAbet for each flagged word")
    args = ap.parse_args()

    raw = open(args.file, encoding="utf-8").read() if args.file else sys.stdin.read()
    g2p, text_normalize = load_g2p()

    text = text_normalize(raw)
    # word tokens only (letters, apostrophes); numbers/punct are handled elsewhere
    tokens = re.findall(r"[A-Za-z][A-Za-z']*", text)

    flagged = {}
    for tok in tokens:
        if is_covered(g2p, tok):
            continue
        key = tok.lower()
        flagged.setdefault(key, tok)

    if not flagged:
        print("No out-of-dictionary words — every word resolves from the dictionary.")
        return 0

    print(f"{len(flagged)} word(s) fall through to the NEURAL predictor "
          "(add ARPAbet overrides to engdict-hot.additions.rep):\n")
    for key in sorted(flagged):
        surface = flagged[key]
        if args.arpabet:
            try:
                guess = " ".join(p for p in g2p.predict(key) if p.strip())
            except Exception as exc:  # noqa: BLE001
                guess = f"<predict failed: {exc}>"
            print(f"  {surface:<24} guessed: {guess}")
        else:
            print(f"  {surface}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
