# Fixing TTS Pronunciation (custom pronunciation dictionary)

How to make the cloned voice pronounce specific English words correctly — medical terms, drug
names, acronyms, names, and other words that come out wrong.

## Why words get mispronounced

GPT-SoVITS picks English pronunciation with a grapheme-to-phoneme (G2P) frontend
(`GPT_SoVITS/text/english.py`). It looks each word up in the CMU dictionary; words that aren't in
CMU (most medical/technical terms) are **guessed**, which is why they sound wrong.

There is a built-in override file, **`GPT_SoVITS/text/engdict-hot.rep`**. Each line is a word plus
its ARPAbet phonemes, and it **hard-overrides** the dictionary. It is re-read every time the
inference server (`api_v2.py`) starts — there is no cache to clear.

## Where the file lives

| Environment | Path | Notes |
|---|---|---|
| Production inference EC2 (`ip-10-0-5-77`, user `ubuntu`) | `/home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep` | Live install. Workers run on the **host via systemd** (`gpu-inference-worker.service`), **not Docker**. |
| Local dev (Windows) | `<GPT_SOVITS_ROOT>\GPT_SoVITS\text\engdict-hot.rep` | Only affects local-mode inference. |

The live path is whatever `GPT_SOVITS_ROOT` resolves to in the active
`gpu-inference-worker/.env` (currently `/home/ubuntu/gpt-sovits-v2pro`).

> ⚠️ On the prod box, `find` also turns up copies under `/opt/gpt-sovits/...` and
> `/var/lib/containerd/...`. **Ignore those** — they are stale leftovers from old/dead test
> containers and are not what the running service uses.

## Procedure (production)

### 1. Connect to the inference box
```bash
aws ssm start-session --target <inference-instance-id> --region ap-southeast-1
# or however you normally SSH in as ubuntu
```

### 2. Back up the current file
```bash
cp /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep ~/engdict-hot.rep.bak
```

### 3. Add your term(s)
Append (one or more lines at once); the leading `\n` guards against a missing trailing newline:
```bash
printf '\nWORD1 P H O N E S\nWORD2 P H O N E S\n' \
  >> /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep
```
…or edit by hand:
```bash
nano /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep
```

### 4. Verify the file
```bash
cat /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep
```
Each line should be `WORD` + phonemes, with nothing glued onto a single line.

### 5. Reload (required)
Changes only load when `api_v2.py` restarts:
- **Webapp:** TTS page → **Stop inference → Start inference**, or
- **Shell:** `sudo systemctl restart gpu-inference-worker.service`, then Start inference in the webapp.

### 6. Test
Generate a sentence containing the new word and listen.

## Entry format

```
WORD  AR PA BET PHONEMES
```

- One word per line; `WORD` in uppercase (matching is case-insensitive on load).
- Phonemes are **ARPAbet**, space-separated. Vowels carry a stress digit
  (`0` none, `1` primary, `2` secondary); consonants take no digit.
- Multi-word terms → **one line per word** (lookup is per-token; phrases on one line won't match).
- Plurals/variants → their own line (`STATIN` vs `STATINS`).
- If a word appears twice, the **last** line wins.

Example:
```
ACETAMINOPHEN AH0 S IY2 T AH0 M IH1 N AH0 F AH0 N
EXERGONIC EH2 K S ER0 G AA1 N IH0 K
ADP EY1 D IY1 P IY1
```

### Valid ARPAbet symbols
- **Vowels (need a stress digit):** `AA AE AH AO AW AY EH ER EY IH IY OW OY UH UW`
- **Consonants (no digit):** `B CH D DH F G HH JH K L M N NG P R S SH T TH V W Y Z ZH`

### Getting the phonemes
- Copy phonemes from a similar word already in `cmudict.rep` (same folder), or use any
  "text → ARPAbet" tool, then tune the stress by ear.
- Verify whether a word is already covered before adding an override — no point overriding a word
  CMU already gets right.

## A note on notation vs. pronunciation

Some "mispronunciations" are not dictionary problems — they are characters the G2P silently drops.
These are fixed in the **input text** (what you paste into the TTS page), not the dictionary:

| In the text | Replace with |
|---|---|
| `Δ` / `∆` (Greek/symbol) | `delta` |
| `+` (e.g. `A+B`) | `plus` |
| `=` (e.g. `ΔG=0`) | `equals` |
| `•` bullets | remove |
| missing space after `.` | add the space |

### Chemical formulas in Live Full

Live Full and Live Full Queue automatically turn compact molecular formulas into
literal, deterministic speech before chunking. Each element symbol stays attached to
its subscript, with a phrase boundary only between counted groups. This keeps the read
natural without letting similar sounds run together. The spelling is intentionally
literal: the same molecular formula can describe more than one compound, so the
preprocessor does not guess a chemical name or expand symbols to element names.

| Input | Spoken text sent to GPT-SoVITS |
|---|---|
| `C6H12O6` | `cee six, aitch twelve, oh six` |
| `H2O2` | `aitch two, oh two` |
| `(CH2O)n` | `open parenthesis, cee, aitch two, oh, close parenthesis, en` |
| `COOH` | `cee oh oh aitch` |
| `NaCl` | `en ay cee el` |

Candidates are checked against real element symbols before they are expanded, so
ordinary acronyms such as `ATP` and `NASA` are not treated as formulas. **Live Fast is
unchanged** and continues to use the shared low-latency text normalization path.

This formula handling does not replace the pronunciation dictionary for actual names
such as `stoichiometry`, `acetylsalicylic`, or a newly introduced compound name. Run
the pronunciation pre-check on a lecture script and add any flagged chemical words to
the chemistry dictionary before generating the full lecture; doing that once up front
avoids discovering deterministic G2P mistakes one audio edit at a time.

## Durability

> The canonical, version-controlled copy of our overrides lives at
> `gpu-inference-worker/pronunciation/engdict-hot.additions.rep` (with its own README). Add new
> terms there and commit them, then apply to the host below — don't let the host file be the only copy.

- Editing the host file is **permanent on this instance** — it survives reboots and service
  restarts.
- It is **lost if the EC2 instance is rebuilt/reimaged** or GPT-SoVITS is reinstalled.
- For durability across a rebuild, also add the same lines to the file inside the S3 bundle
  `s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip`, then rebuild/redeploy the
  inference image. (See the v2ProPlus reproducibility task and
  `docs/containerization-images-split.md`.)
