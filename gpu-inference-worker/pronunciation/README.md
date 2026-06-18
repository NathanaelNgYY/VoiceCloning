# Pronunciation overrides (`engdict-hot.additions.rep`)

Canonical, version-controlled copy of the custom ARPAbet pronunciation overrides we
feed to GPT-SoVITS. GPT-SoVITS guesses the pronunciation of any word not in the CMU
dictionary (most scientific / medical / technical terms), so those words come out
wrong **deterministically** — the same wrong sound every time, which retries and
re-seeding cannot fix. The fix is a hard phoneme override in
`GPT_SoVITS/text/engdict-hot.rep`, which the inference server re-reads on startup.

This file exists so those overrides live in git (reproducible, reviewable, durable)
instead of only on the EC2 host, where they are lost on a rebuild/reimage. It is the
source of truth; the host file is a deployment target.

Full background, file location, and ARPAbet rules: `docs/pronunciation-dictionary-runbook.md`.

## Apply to the running inference box

```bash
# 1. back up the live file
cp /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep ~/engdict-hot.rep.bak

# 2. append these additions (the leading newline guards a missing trailing newline)
printf '\n' >> /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep
cat engdict-hot.additions.rep >> /home/ubuntu/gpt-sovits-v2pro/GPT_SoVITS/text/engdict-hot.rep

# 3. reload — restart inference (engdict-hot.rep is only read on api_v2.py startup)
sudo systemctl restart gpu-inference-worker.service
#   …then click Start inference in the webapp, or use the TTS page Stop → Start buttons.
```

This file is pure `WORD  PHONEMES` data (blank lines only, no inline comments) so it
can be `cat`-appended directly. If a word already exists in the host file, the **last**
line wins, so re-appending is safe.

## Durability across an EC2 rebuild

Editing the host file is permanent on that instance but lost if the box is reimaged.
To survive a rebuild, also fold these lines into the `engdict-hot.rep` inside the S3
bundle `s3://interns2026-small-projects-bucket-shared/echolect/GPT-SoVITS.zip` and
rebuild the inference image (see the v2ProPlus reproducibility task).

## Maintaining

When you find a new mispronounced word, add one `WORD  ARPAbet` line here (uppercase
word; vowels carry a stress digit `0/1/2`), commit it, then re-apply with the steps
above. Verify by ear — generate a sentence containing the word. Plurals and variants
each need their own line (`ENZYME` vs `ENZYMES`).
