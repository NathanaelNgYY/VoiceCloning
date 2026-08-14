# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Learners (primary product users):** LKCMedicine (NTU) medical students working through a
GI-bleeding teaching video on their own, usually once, often on a shared kiosk or their own
laptop. They watch, read the transcript as it reveals, and ask an AI tutor questions by voice or
text when something does not land.

**Faculty and tutors (users of the admin analytics surface):** clinical educators reviewing their
own students. Non-technical, occasional use — they open the dashboard between teaching sessions to
find the few learners or concepts that may need follow-up, not to browse. Confirmed 2026-08-13.

**Project/research team:** secondary readers of the same admin surface, validating that the
analytics pipeline records what it should. Their needs sit one level below the educator's.

## Product Purpose

A single video lesson plus a voice-capable AI tutor that answers questions in the context of the
exact moment of the video the learner is on. The admin analytics surface exists so an educator can
see where a cohort struggled without giving anyone a grade — it converts learning *behaviour*
(questions asked, rewatches, pauses, transcript re-reads) into a per-concept signal that a human
then judges.

Success for the lesson: a learner finishes understanding the concepts. Success for the dashboard:
an educator identifies who or what needs attention in the first few seconds, and trusts what they
are looking at.

## Positioning

The tutor knows *where in the video* the learner is and what was said there, so a question like
"what does she mean here?" resolves against the real transcript and timestamp. The analytics are
derived from that same in-lesson behaviour rather than from a quiz — there is no test, so the
signal is behavioural evidence, never a score of the learner.

## Operating Context

- One lesson today (`gi-bleeding`); the design must let a lesson switcher slot in later without
  re-architecting the page. Confirmed 2026-08-13.
- Realistic dashboard scale: **~100–300 identified learners**, roughly 6–12 authored concepts.
  The student list therefore needs search, sort and filter to stay usable. Confirmed 2026-08-13.
- Sign-in is Microsoft Entra SSO; the admin dashboard is role-gated and returns 403 to accounts
  without admin analytics access.
- Per learner the system retains: concept evidence records, stored lesson actions (newest 500,
  with a truncation flag), and questions asked from retained conversation history.

## Capabilities and Constraints

- **Evidence model:** five behavioural signals — concept question, repeated question, rewatched
  segment, long pause, reviewed transcript — accrue a per-concept `evidenceScore`. Evidence decays
  with a 14-day half-life and repeated instances of the same signal contribute progressively less.
  There is no hard score cap.
- **Thresholds:** `possible_support` at 0.75, `support_recommended` at 1.55. Three states exist:
  no support inference, possible support, support recommended.
- **Destructive affordance:** per-concept "reset evidence" exists, is irreversible, and is
  currently confirmed through a browser `confirm()`.
- **No grading:** the product has no quiz, score, or pass/fail. Nothing in this system may be
  presented as an assessment of a learner.
- Client is React 18 + Vite + Tailwind + shadcn/ui (Radix), React Router 6. Client tests run on
  `node --test`. The kiosk build ships via `npm run build:chatbot` → `dist-chatbot`.

## Brand Commitments

- LKCMedicine maroon `#7c1d6f` is the product's primary colour, already tokenised as `--primary`
  scoped to `.gi-root`, with `--primary-soft` `#f4f1f8` as its tint.
- Chart marks are a validated pair: `--chart-recommended` `#a32a92` and `--chart-possible`
  `#d97706`, chosen for colour-vision-deficiency separation and contrast on white. Changing either
  requires re-validating both.
- Inter is the shipped typeface.

## Evidence on Hand

- Real transcript and word timings for the GI-bleeding lesson (`api/giBleedingWordTimings.json`),
  transcribed locally 2026-07-27 — this is genuine lesson content, not placeholder copy.
- Live analytics records from real NTU sign-ins on staging since 2026-08-06.
- No testimonials, benchmarks, published outcomes, or efficacy claims exist. Future work must not
  fabricate them, and must not imply the support signals have been clinically or pedagogically
  validated.

## Product Principles

1. **Signals prompt a human, they never judge one.** Every presentation of evidence must read as
   "worth a look", never as a verdict about a learner's ability.
2. **The educator's first question is "who or what needs me now."** Aggregate patterns and the
   short list of flagged learners outrank exhaustive per-event detail.
3. **Raw evidence stays reachable, one level down.** Trust in a behavioural inference depends on
   being able to see exactly which events produced it.
4. **The lesson's world is the product's world.** Admin surfaces are part of the same product as
   the lesson, not a separate internal tool.
5. **Irreversible actions are rare and deliberate.** Resetting evidence destroys audit trail and
   must stay hard to do by accident.

## Accessibility & Inclusion

Status states must never be carried by colour alone — the recommended/possible pair is already
CVD-validated, and every status also needs a label or shape. Charts need a text equivalent.
Reduced-motion preferences are already honoured in the lesson transcript reveal and the existing
chart animation, and must stay honoured.
