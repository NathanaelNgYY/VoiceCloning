# Per-user chat transcript storage — design plan

**Status:** implemented and verified locally; **not deployed**.
**Related:** `docs/staging-architecture.md` (staging stack), `client/env/staging/gi.env` (SSO config, staged but **not deployed**).

## Decision log

Reviewed with the AWS/tenant owner on 2026-08-03. The approach below was confirmed as
matching how they would set it up themselves.

| Item | Outcome |
|---|---|
| Backend identity | **Option (ii), the API scope** — see Decision 1 |
| Redirect URIs | Reported added by the tenant owner 2026-08-03 (ahead of the 08-04 ETA). Not yet exercised by a real sign-in — see Verified so far |
| DynamoDB table + IAM | **Table created 2026-08-03** by us, not the owner — see The account the table lives in |
| MFA | Not required for this app |
| Token lifetime | ~24 h; not a constraint, identity is bound once at WS connect |
| Access policies | Satisfied — the gi build has no admin surface (`GiApp.jsx` omits admin routes) |
| Retention | **90 days** on identifiable rows, plus a de-identified export with no expiry. Decided 2026-08-03, pending supervisor confirmation — see Retention and privacy |
| Purpose | **Research export**, not user-facing history. Research reads the de-identified copy, so no read path is needed |
| Consent | Notice shown at sign-in. Whether IRB coverage is also required is **still open** |

## Goal

Persist each student's GI-lesson chat transcript, attributed to the NTU account they
signed in with, so a conversation can be retrieved per user after the fact.

## Prerequisite: identity has to be verified server-side

The Entra sign-in staged in `client/env/staging/gi.env` is a **frontend gate only**. It
decides what the browser renders; it does not make the backend aware of who is calling.
The Lambda router and live gateway accept unauthenticated requests today.

That is acceptable for gating a lesson page. It is not acceptable for attributing a
transcript: if the browser tells the server "I am user X", anyone calling the gateway
directly can write turns under another student's identity, and later read them back.

**So this feature requires real token validation in the gateway.** That is the larger
piece of work here — larger than the storage choice.

### Decision 1 — how the backend learns who the user is

| | ID token | API scope (access token) |
|---|---|---|
| Portal work | none | must "Expose an API", define a scope, possibly get admin consent |
| Client code | `acquireMicrosoftIdToken()` already exists in `client/src/auth/msalClient.js`, currently unused | `acquireApiAccessToken()` also exists; needs `VITE_ENTRA_API_SCOPE` + `VITE_API_AUTH_MODE=entra` |
| Token audience | `aud` = the app's client ID | `aud` = `api://<clientId>` |
| Correctness | acceptable when the API and the SPA are the same app, and validation is strict | the textbook OAuth answer for a protected resource |
| Blocked by | nothing | whoever administers the NTU tenant |

**Selected: the API scope (option ii).** The original recommendation here was the ID token,
chosen only because the portal work looked blocked. It is not — the tenant owner offered the
permissions on 2026-08-03, and there is no house standard to conform to. Since the
gateway-side work is identical either way (same JWKS verification; only the expected `aud`
differs), one portal request buys the properly-scoped design at near-zero extra cost.

> **Reversed 2026-08-05 — back to the ID token (option i).** The premise above was wrong:
> the offer never landed. Probing the authorize endpoint directly still returns
> `AADSTS65005: … asked for scope 'access_as_user' that doesn't exist`, and NTU-side
> approvals have since proved hard enough that the app registration itself had to stay
> outside NTU's tenant. Waiting on the scope was blocking the whole feature.
>
> ```bash
> # Reproduce: an unauthenticated GET, no credentials needed.
> curl -s "https://login.microsoftonline.com/common/oauth2/v2.0/authorize\
> ?client_id=9b5c52c0-5f02-4dbf-83ac-c68d246abc68&response_type=code\
> &redirect_uri=http%3A%2F%2Flocalhost%3A5173\
> &scope=openid%20api%3A%2F%2F9b5c52c0-…%2Faccess_as_user"
> ```
>
> The cost of the scope was also understated above. `getInteractionScopes()` appends it to
> the **login** request, so a missing scope fails sign-in outright — the symptom is "SSO is
> broken", nowhere near the setting that caused it. That is why the local env had it
> commented out on 2026-08-03 to test anything at all.
>
> What changed: `VITE_API_AUTH_MODE=entra-id`, and `ENTRA_AUDIENCE` in both backends drops
> the `api://` prefix to the bare client ID. No gateway or Lambda code changed — the
> verifier never looked at `scp`, so an ID token satisfies it unaltered. The mode decision
> moved into `client/src/auth/apiTokenMode.js` so it could be unit-tested away from MSAL.
>
> **Switching back** if the scope is ever exposed: set `VITE_ENTRA_API_SCOPE`, flip the mode
> to `entra`, and restore `api://` on both `ENTRA_AUDIENCE` values — all three together.
> `giPublicAccess.test.js` derives the expected audience from the mode and fails if they
> disagree.
>
> **What this trades away.** An ID token authenticates a user to the app; an access token
> authorises a caller to an API. Using the first as the second is acceptable here because
> the SPA and the API are one application and validation is strict (`aud` pinned to this
> client, `tid` to NTU, RS256 only). It gets weaker the moment a second client or a second
> API appears — there is then no per-API audience to separate them. Revisit at that point,
> not before.

Requested from the tenant owner: "Expose an API" on the registration with app ID URI
`api://9b5c52c0-5f02-4dbf-83ac-c68d246abc68`, one scope (`access_as_user`), plus admin
consent if the tenant requires it.

This inverts a guard in `client/src/giPublicAccess.test.js`: it currently asserts
`VITE_API_AUTH_MODE` / `VITE_ENTRA_API_SCOPE` stay **unset**, which was correct while no
backend validated tokens. Once the scope exists both become required —
`VITE_API_AUTH_MODE=entra` and `VITE_ENTRA_API_SCOPE=api://…/access_as_user` — and the test
must be flipped to assert their presence in the same change.

### Third option, considered and not recommended: Cognito federated to Entra

A Cognito user pool can federate to Entra as an OIDC provider: students still sign in with
their NTU account, but Cognito mints the tokens, and an **API Gateway JWT authorizer**
validates them before the Lambda ever runs. No hand-rolled JWKS code. This is roughly what
the sibling project does (see Prior art below), minus the federation.

It does not fit here, because the authorizer only helps on the API Gateway path. The
transcript content lives in the live gateway's WebSocket, which sits behind an ALB on EC2 —
API Gateway is not in that path, so validation would still have to be hand-rolled there.

Taking the authorizer route would mean moving transcript writes to the Lambda router and
having the *client* post turns. That trades hand-rolled validation for a client-driven
write path, which loses data whenever a kiosk user walks away mid-session — the most common
failure mode we have. Reconsider only if the write path moves off the WebSocket for other
reasons.

### Validation the gateway must perform

Reject the connection unless **all** hold:

- signature verifies against the NTU JWKS
  (`https://login.microsoftonline.com/15ce9348-be2a-462b-8fc0-e1765a9b204a/discovery/v2.0/keys`, keys cached)
- `iss` = `https://login.microsoftonline.com/15ce9348-be2a-462b-8fc0-e1765a9b204a/v2.0`
- `aud` = `api://9b5c52c0-5f02-4dbf-83ac-c68d246abc68` (the API's app ID URI, now that
  option (ii) is selected — it would be the bare client ID on the ID-token route)
- `tid` = the NTU tenant, `exp` in the future
- `preferred_username` ends in one of the three allowed NTU domains

Skipping any one of these turns the check into decoration. In particular, validating the
signature but not `aud` accepts tokens minted for a completely different application.

### The user key is `oid`, not email

Use the `oid` claim (immutable per-user object ID) as the partition key. Email and UPN
change — a name change would silently fork one student's history into two users. Store
email and display name as attributes for human readability, and treat them as a snapshot
of what was true at write time.

## Decision 2 — DynamoDB over S3

**Recommendation: DynamoDB** for transcript records. S3 only if generated audio is also
retained, in which case the S3 key goes on the turn item as an attribute.

Cost does not decide this: at ~150 users × 3 turns, both options are cents.

The deciding factor is that **S3 has no append**. Adding a turn means read-modify-write of
the whole transcript object. Two turns landing close together — routine with barge-in in a
kiosk conversation — and one silently overwrites the other. Working around it means
building a locking scheme. DynamoDB's per-turn `PutItem` has no such race, and
"everything for this user" is a native `Query` rather than a prefix listing plus fetches.

### Data model

```
PK  USER#<oid>
SK  PROFILE
    lastSeenAt, email, displayName, ttl

PK  USER#<oid>
SK  SESSION#<sessionId>#META
    startedAt, email, displayName, lessonSlug, ttl

PK  USER#<oid>
SK  SESSION#<sessionId>#TURN#<seq, zero-padded>
    role ("user" | "assistant"), text, ts, voiceProfileId, [audioS3Key], ttl
```

- One user's whole history: `Query` on `PK = USER#<oid>`.
- **`PROFILE` is written at sign-in, not on the first turn**, and that is the whole
  reason it exists separately from session `META`. META waits for a real turn — by
  design, so kiosk users who open the page and walk away leave no empty session — which
  means a student who signs in and never asks anything would otherwise appear in no row
  at all. `PROFILE` is the record of who *reached* the lesson, as opposed to who talked
  to it. `"PROFILE" < "SESSION#…"` lexicographically, so it sorts first in that Query.

  > **Corrected 2026-08-05.** Until step 9 below, that paragraph described an intent the
  > code did not implement. `PROFILE` was written by `openSession`, which runs on the
  > **WebSocket** handshake — and the client only opens that socket when the student
  > presses the microphone (`useLiveSpeech.js`, after the `getUserMedia` prompt). So the
  > row recorded who reached the *microphone*, not who reached the lesson, and everyone
  > who signed in and read without speaking was still invisible. The sign-in endpoint in
  > step 9 is what makes the sentence above true.
- A returning student overwrites their own `PROFILE`, and its `ttl` slides forward on
  each sign-in so an active student's row cannot expire under their live transcripts.
  `firstSeenAt` is deliberately absent: keeping it would need a read before every write,
  and the earliest session `META` already serves that for anyone who spoke.
- **A second table for users was considered and rejected.** It buys nothing on lookup —
  both designs are key lookups — and costs a second IAM grant, which is the current
  bottleneck. The one real argument for splitting is the roster query: "list all users"
  is a `Scan` that reads every turn row to find the few user rows. If that becomes
  expensive, the fix is a GSI (`GSI1PK="USER"`, `GSI1SK=<oid>`), not another table.
  Split only when user records grow attributes unrelated to conversations — cohort,
  enrolment, grades — which is a different entity with a different lifecycle.
- One session: `Query` with `begins_with(SK, "SESSION#<id>")`; zero-padded `seq` keeps
  turns in order under lexicographic sort.
- Per-turn items stay far below the 400 KB item cap. A whole session as one item would
  not, on a long conversation.
- Native `ttl` attribute gives retention for free (see below).
- Table region **ap-northeast-2**, next to the gateway EC2 host. Note the standing
  region split: the shared S3 bucket is ap-southeast-1.

## Write path — the gateway, not the client

The live gateway already sees both sides of the conversation:

- user speech — `conversation.item.input_audio_transcription.completed`
  (`live-gateway/src/services/openaiRealtimeEvents.js:241`)
- assistant text — `openaiRealtimeEvents.js:298`

**Replies are not stored by default** (`TRANSCRIPT_STORE_ASSISTANT=false`, decided
2026-08-05). What the student asked is the research interest, and the model's answers are
largely reproducible from the prompt and the lesson. Kept as a flag rather than deleted
code, because the cost is invisible and permanent: a follow-up like "what about the other
one?" has no recoverable meaning without the reply it answered, and no amount of later
effort can backfill a turn that was never written. Set it true before any session where
that context matters.

It is a single writer with the full turn, and needs no client trust for transcript
*content*. The alternative — the client POSTing a transcript at session end — loses data
constantly on a kiosk, where people walk away mid-session.

Bind identity once at the WebSocket upgrade (`live-gateway/src/routes/liveChat.js:145`),
then attach `oid` to the bridge for the socket's lifetime.

**Send the token in a first auth frame, not a query parameter.** Browser WebSockets cannot
set an `Authorization` header, and query strings land in CloudFront and ALB access logs —
which would write bearer tokens to durable storage we do not control.

## Two operational consequences

### The load tests will break

`scripts/load-test-staging-chatbot.mjs` opens the WS with no token. Once the gateway
requires auth, every load test fails — precisely when they are needed for the 150-user
August rehearsal (`docs/staging-architecture.md` § "Next capacity experiment").

Design the bypass up front: an env-gated allowance or a load-test shared secret, decided
deliberately rather than discovered on rehearsal day. Whatever it is must be impossible to
enable by accident in production.

### The gateway needs an IAM permission we may not be able to grant

Writing to DynamoDB requires `dynamodb:PutItem` on the gateway host's instance profile
(`VoiClo_GPU`). Per the known denials in `docs/staging-architecture.md` §9, the intern role
is denied `iam:*` — so attaching that policy is likely a console/admin task, not something
scriptable from this machine. Confirm this early; it gates the whole feature.

## Retention and privacy

### The decision

Retention limits apply to data that *identifies* someone, so the two uses are separated
rather than forced onto one number:

- **Identifiable rows — 90 days** (`TRANSCRIPT_TTL_DAYS`, which defaults to 90 so that
  forgetting to configure it cannot mean indefinite retention). Long enough for anything
  operational: debugging a bad answer, checking what a student was told, handling a complaint.
- **De-identified export — no expiry.** `scripts/export-transcripts-deidentified.mjs` replaces
  `oid` with a salted hash and drops session metadata entirely. That output is not personal
  data, so it carries no retention limit — which gives the research use *more* durability than
  a flat 12-month policy would, not less.
- **A notice at sign-in**, naming what is stored, who it is tied to, why, and for how long.

**Still pending supervisor confirmation.** The 90 days is a proposal, not an approved policy,
and the consent question below is genuinely open.

### Why not indefinite

The tenant owner's position (2026-08-03) was that no TTL is needed, on the grounds that the
information is not especially sensitive. That is true of the *lesson material*, which is not
confidential. The concern is what students volunteer into a free-text medical Q&A: in a
GI-bleeding lesson some will describe their own or a relative's symptoms. Tied to a verified
NTU identity, that is health-adjacent personal data about an identifiable individual, and
PDPA's retention limitation says it should not be held longer than the purpose requires.

Indefinite may still be someone's call to make — but it should be a decision, not a default,
and it is the one option that cannot be justified as "as long as we need it".

### Still open

- **Consent / IRB.** The distinction that decides it: are we *studying the students* or
  *improving the lesson*? Published findings about students are human-subjects research and
  need IRB coverage; internal quality improvement normally needs only the notice. The
  supervisor knows which bucket this pilot sits in.
- Do not log transcript text to CloudWatch alongside the identity; that duplicates the
  personal data into a second store with a different retention policy.

## Prior art: `interns2025-drchow-external-chatbot`

A sibling intern project solves the same shape of problem. Local checkout:
`C:\Internship\codecommit repositories\interns2025-drchow-external-chatbot`.

**What it does.** AWS Cognito, not Entra. `aws-amplify/auth` against a user pool configured
in `src/main.tsx:12`; `src/pages/Auth/Login.tsx` does email + password via `signIn` /
`confirmSignIn` — no federated provider, so its users are accounts in its own pool rather
than NTU tenant logins. The browser attaches `Authorization: Bearer <idToken>`
(`src/api/analytics.ts:17`), an API Gateway JWT authorizer validates it, and the Lambdas
read the resulting claims (`backend/.../utils/getUserId.mjs`), keying users off Cognito `sub`.

**What confirms our design.** Its storage is DynamoDB single-table with `PK`/`SK` and
`begins_with(SK, …)` queries (`backend/.../utils/db.mjs:22`) — the same model proposed
above, arrived at independently. Its analytics rows partition by *group*
(`LEARNER_GROUP#<id>#ANALYTICS` / `EVENT#<ts>#<sub>`), which suits instructor dashboards;
`USER#<oid>` remains the right partition for "show me my own history".

**What not to copy.** `getUserId.mjs` resolves the caller through a fallback chain ending in
client-controlled input:

```js
event?.headers?.["x-user-id"] || null
...
if (!sub) { console.warn("⚠ WARNING: No authenticated user..."); return "anonymous-user"; }
```

On any route where the authorizer is missing or bypassed, a caller can set `x-user-id` and
read or write as another user — the request succeeds with only a CloudWatch warning. An
unauthenticated caller silently becomes `anonymous-user` instead of being rejected. Our
gateway must **fail closed**: no valid token, no session, no write. (Whether that project's
authorizer is actually attached to every route is unverified — `IMPLEMENTATION_SUMMARY.md`
does not mention one. Worth raising with its owner separately; it is not a blocker here.)

## Open questions

1. ~~**Purpose**~~ — settled: research export. Research reads the de-identified copy, so no
   read path or history UI is needed.
2. ~~**Retention period**~~ — settled at 90 days on identifiable rows, pending supervisor
   confirmation.
3. **Audio** — text only, or keep the generated WAVs in S3 too? Currently text only.
4. ~~**Scope**~~ — settled: GI only.
5. **Consent / IRB** — with the supervisor; see Retention and privacy.

## Implementation order

1. ~~Confirm the IAM permission is obtainable.~~ Agreed 2026-08-03; being provisioned.
2. ~~SPA redirect URIs registered, API scope exposed, DynamoDB table in place.~~ Reported
   done by the tenant owner 2026-08-03; table created by us the same day (see above).
   The **SPA**-vs-Web platform question is still only verifiable by signing in: a Web-platform
   registration fails at token redemption with AADSTS9002326, not at the login page.
3. Verify sign-in end-to-end. **Done locally on `http://localhost:5173`, not on staging** —
   see Verified so far. Staging verification waits for a deploy.
4. ~~Client: switch to `VITE_API_AUTH_MODE=entra` + `VITE_ENTRA_API_SCOPE`, flip the
   `giPublicAccess.test.js` guard accordingly.~~ **Done** — plus two new guards that catch
   the failure modes the flip introduces: the requested scope must reduce to the
   `ENTRA_AUDIENCE` both backends check, and both backends must actually have
   `LIVE_AUTH_ENABLED=true` (an audience alone leaves the guard `null`).
5. ~~Gateway: JWKS validation + bind identity at WS connect, behind a flag.~~ **Done** —
   `services/entraToken.js`, `services/liveChatAuth.js`, gate wired into
   `routes/liveChat.js`. Off unless `LIVE_AUTH_ENABLED=true`; 39 tests.
6. ~~Load-test bypass.~~ **Done** on both sides — `LIVE_AUTH_LOADTEST_SECRET` in the gateway
   and the Lambda, `VCS_CHATBOT_LOADTEST_SECRET` in `scripts/load-test-staging-chatbot.mjs`,
   which now sends the `session.auth` frame. Both secrets ship **empty**: a rehearsal has to
   set them deliberately on both ends, and clearing either one closes the bypass.
7. ~~Per-turn DynamoDB writes.~~ **Done** — `services/transcriptStore.js` (item shape and
   keys, SDK-free and unit-tested), `services/dynamoTranscriptClient.js` (the only file that
   imports the AWS SDK, client built lazily), tapped off the bridge's `app-event` stream in
   `routes/liveChat.js`. Inert unless `TRANSCRIPT_TABLE_NAME` is set.
8. ~~Read path.~~ Not needed — the purpose question settled as research export, which reads
   the de-identified copy rather than the table.
9. ~~Record the sign-in itself, not just the conversation.~~ **Done 2026-08-05** — see below.

### Step 9 — `POST /api/live/session/signin`

Closes the gap described under Data model: the student is recorded when SSO completes,
independently of whether they ever speak.

| | |
|---|---|
| Gateway | `routes/signIn.js` — verifies `Authorization: Bearer <token>` with the *same* authenticator as the socket, then calls the store. `index.js` builds the authenticator and store **once** and shares them with both, so there is one JWKS cache rather than two fetching Microsoft's keys on separate schedules. |
| Store | `transcriptStore.recordSignIn(identity)`, factored out of `openSession`, which still calls it — whichever path runs first writes the same row under the same key, so the repeat write overwrites rather than duplicating. |
| Client | `services/signInRecord.js` (pure, dependency-free, tested) + `services/signInReporter.js` (MSAL/`import.meta.env` wiring, not importable under `node --test` — the split `auth/apiTokenMode.js` explains). Fired by `SignInRecorder` in `GiApp.jsx` once per authenticated mount. |
| Failure policy | Fire-and-forget in every branch: no token, token acquisition throws, gateway down, gateway 401, no `fetch`. `recordSignIn` never rejects, because the caller uses `void`. A missed record is a gap in research data; a blocked sign-in is a broken lesson. |
| Identity source | The verified token, and nothing else. The request has **no body**, so there is no field a caller could set to write a row under another student's name. |
| Load-test bypass | Deliberately **not** accepted here. A load test has no interactive sign-in to record, and the socket already has the bypass it needs. |

**No new environment variables.** It is governed by the two that already exist:
`LIVE_AUTH_ENABLED` (off → 503 `auth_disabled`) and `TRANSCRIPT_TABLE_NAME` (empty → 200
with `storage:"disabled"`, which distinguishes a deploy mistake from a deliberately
skipped write).

#### A CORS bug this uncovered

`index.js` passed the raw `CORS_ORIGIN` string to `cors({ origin })`, which compares a
string origin with `===`. With four origins configured, **every** browser HTTP request
got no `Access-Control-Allow-Origin` and was blocked. It had never shown up because the
WebSocket is not subject to CORS and does its own comma-splitting in `originAllowed()`.
This route is the first browser HTTP call to the gateway, so it would have failed 100% of
the time on staging. Fixed with `parseCorsOrigins()` in `config.js`; verified by preflight
against the *second* origin in the list, which is the case that was broken.

### Gateway env added by step 7

`TRANSCRIPT_TABLE_NAME` (empty disables storage entirely), `TRANSCRIPT_TABLE_REGION`
(default `ap-northeast-2`), `TRANSCRIPT_TTL_DAYS` (default `90`, per the retention decision
above; `0` writes no `ttl` attribute and nothing expires), `TRANSCRIPT_STORE_SYNTHETIC` (default
`false`, so load-test rehearsals are not written).

Transcripts are only recorded on authenticated sessions — with `LIVE_AUTH_ENABLED=false`
there is no identity to attribute a turn to, so nothing is stored. The gateway also adds
`@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` (3 dependencies → 5), which means the
EC2 host needs an `npm install` at deploy.

### The table — created 2026-08-03

```
Name     vcs-staging-transcripts
ARN      arn:aws:dynamodb:ap-northeast-2:329599637774:table/vcs-staging-transcripts
Keys     PK (S, HASH), SK (S, RANGE)
Billing  PAY_PER_REQUEST
TTL      attribute "ttl", ENABLED
Tags     CreatorId=INTERNS2026
```

TTL was enabled at creation rather than later: items written without a `ttl` attribute
never expire, so doing it now keeps the retention decision a config change rather than a
backfill over rows that already exist.

### The account the table lives in

Worth writing down, because the obvious credentials are the wrong ones.

The NTU SSO login (`AWSReservedSSO_Identity-Switch-Role`, account **116310094355**) has **no
DynamoDB permissions at all** — not `CreateTable`, not even `ListTables` or `DescribeTable`,
in either region. It is only a stepping stone: `~/.aws/config`'s `dl-account` profile uses it
as `source_profile` to assume **`arn:aws:iam::329599637774:role/Nathanael_Ng_Intern2026`**,
and that role is where DynamoDB access lives. The staging GPU host
(`i-0f0da8be59367f7a8`, instance profile `VoiClo_GPU`) is in the same account 329599637774,
which is what makes a table there reachable from the gateway.

So the earlier note that "table creation is his job" was wrong about the reason: it was not a
missing grant, it was probing with the un-assumed role.

```bash
aws sts assume-role --role-arn arn:aws:iam::329599637774:role/Nathanael_Ng_Intern2026 \
  --role-session-name vcs --region ap-southeast-1
```

**Still unverified:** whether `VoiClo_GPU` carries `dynamodb:PutItem` on this table. This role
is denied `iam:ListAttachedRolePolicies` / `iam:ListRolePolicies` (consistent with the
`iam:*` denials in `docs/staging-architecture.md` §9), so it cannot be read from here. The
local run proves the code and the table, not the EC2 instance profile — the first staging
deploy is where that shows up, as `[transcript] write failed` in the gateway log while the
conversation itself keeps working.

### Gateway env added by step 5

`LIVE_AUTH_ENABLED` (default `false`), `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE` (the
`api://…` URI), `ENTRA_ALLOWED_EMAIL_DOMAINS`, `LIVE_AUTH_LOADTEST_SECRET` (empty disables
the bypass — it is never implied by enabling auth). Turning `LIVE_AUTH_ENABLED` on without
tenant and audience set is a startup failure, not a silent open door.

The client sends `{"type":"session.auth","token":"…"}` as its first frame and waits for
`{"type":"session.authenticated"}`. Failures close with 4401 (unauthorized), 4403
(forbidden — wrong domain, guest, wrong tenant) or 4408 (handshake timeout).

## Running the local verification

Nothing here is deployed. Two processes, both reading the staged config:

```bash
# 1. Gateway, with auth and storage on. Credentials come from the assumed
#    Nathanael_Ng_Intern2026 role (see The account the table lives in).
cd live-gateway
LIVE_AUTH_ENABLED=true \
ENTRA_TENANT_ID=15ce9348-be2a-462b-8fc0-e1765a9b204a \
ENTRA_AUDIENCE=9b5c52c0-5f02-4dbf-83ac-c68d246abc68 \
ENTRA_ALLOWED_EMAIL_DOMAINS=staff.main.ntu.edu.sg,student.main.ntu.edu.sg,assoc.main.ntu.edu.sg \
TRANSCRIPT_TABLE_NAME=vcs-staging-transcripts \
TRANSCRIPT_TABLE_REGION=ap-northeast-2 TRANSCRIPT_TTL_DAYS=90 \
AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_SESSION_TOKEN=… \
node src/index.js

# 2. Client, on 5173 — see client/.env.gi.local (untracked) for why the port matters.
cd client && npm run dev:gi:sso
```

`GET /readyz` on 3002 must return `{"ok":true,"problems":[]}`; with auth on but the tenant
or audience missing it returns 503 with the reason, which is the failure this arrangement is
designed to make loud.

## Verified so far

Verified locally on 2026-08-03, against the real NTU tenant and the real table:

- **The gate is live and fails closed.** Six rejection paths exercised against the running
  gateway: no handshake frame → 4408; malformed token → 4401 `malformed`; well-formed but
  unsigned JWT with every claim correct → 4401 `unknown_key`; `alg:none` → 4401
  `bad_algorithm`; load-test bypass with no secret configured → 4403; a pre-auth client
  sending `session.init` first → 4401 `missing`. The `unknown_key` case is the informative
  one — reaching a *key lookup* means the gateway really fetched NTU's JWKS rather than
  short-circuiting.
- **The write path works against the real table**, driven through `transcriptStore` →
  `dynamoTranscriptClient` → DynamoDB: a `#META` row plus two zero-padded `#TURN#` rows in
  order, `ttl` resolving to 90 days out, and an all-whitespace turn correctly not written.
  Probe rows deleted afterwards.
- **Tests:** 322 client, 153 gateway, 118 Lambda, all passing (2026-08-05, after step 9).

### Blocked 2026-08-03, and the bigger one: the app is in the wrong tenant

```
AADSTS50020: User account 'CS-NATHANAEL.NG@assoc.main.ntu.edu.sg' from identity provider
'https://sts.windows.net/15ce9348-be2a-462b-8fc0-e1765a9b204a/' does not exist in tenant
'Default Directory' and cannot access the application '9b5c52c0-…' (GI Bleeding).
```

**`45e82b6b-5ac4-41a7-a36f-e702e5e3a355` is not the NTU tenant.** Every comment in this
document and in `client/env/staging/gi.env` that calls it that is wrong. Resolved from
Microsoft's own discovery documents:

| Domain | Tenant |
|---|---|
| `ntu.edu.sg`, `student.main.ntu.edu.sg`, `assoc.main.ntu.edu.sg` | `15ce9348-be2a-462b-8fc0-e1765a9b204a` |
| the "GI Bleeding" app registration | `45e82b6b-5ac4-41a7-a36f-e702e5e3a355` ("Default Directory") |

```bash
curl -s https://login.microsoftonline.com/student.main.ntu.edu.sg/v2.0/.well-known/openid-configuration
```

So the MSAL authority, `ENTRA_TENANT_ID`, and the JWKS URL the gateway checks signatures
against all point at a directory that contains no NTU students. This is not a
misconfiguration to patch — the registration has to move.

**Inviting students as guests is not a workaround.** A B2B guest's `preferred_username`
becomes `CS-NATHANAEL.NG_assoc.main.ntu.edu.sg#EXT#@<defaultdir>.onmicrosoft.com`, which
fails `ENTRA_ALLOWED_EMAIL_DOMAINS`, and both the client (`isAllowedAccount`) and the
gateway (`guest_account` TokenError) reject `#ext#` accounts deliberately. Relaxing those
would defeat the point: `tid` would be the Default Directory, so the token would prove only
that someone was invited, not that they are an NTU student. It also means 150 individual
invitations.

The fix is either a registration inside tenant `15ce9348` (single-tenant, matches this
design as written), or making the existing app multi-tenant and re-pinning every tenant
reference to `15ce9348` — the latter still needs NTU admin consent, and asks NTU students to
authenticate against an app in a directory NTU does not control.

**Resolved 2026-08-05: multi-tenant, because the first option was refused.** NTU IT will not
take an app registration without an approval submission, so the registration stays in the
Default Directory and is marked multi-tenant instead. The repo now reflects that:

| Setting | Value | Why there |
|---|---|---|
| `VITE_ENTRA_TENANT_AUTHORITY` | `https://login.microsoftonline.com/common` | Pinning it to the registration's own directory is what returns AADSTS50020 — that directory holds no NTU accounts. `/common` resolves the signer's home tenant |
| `ENTRA_TENANT_ID` (gateway **and** Lambda) | `15ce9348-…` | The tenant that now actually issues the token |

The pin moved from the client to the backends rather than disappearing, which is the stronger
place for it: a build is editable by whoever serves it, a token check is not. `/common` widens
routing, not access — `entraToken.js` still rejects any `tid`/`iss` that is not NTU's, so an
account from any other tenant that reaches the login page still cannot get past the gateway.

**Still not verified, and the last thing that can block this:** an NTU account signing in to an
externally-registered app triggers a consent prompt. If NTU's tenant permits user consent it
resolves itself; if not it fails with `AADSTS65001` and needs **admin consent for app
`9b5c52c0-…`**. That is a smaller ask than a registration submission, but it is still an NTU-side
approval, and nothing in this repo can settle it.

### Blocked 2026-08-03: the API scope does not exist

Sign-in fails outright:

```
AADSTS65005: The application '9b5c52c0-…' asked for scope 'access_as_user' that doesn't exist.
```

The tenant owner reported adding it, but the registration does not expose it. Most likely
it was added under **API permissions** (what this app may call) rather than **Expose an
API** (what this app offers) — adjacent blades that both read as "adding an API scope".

Neither this machine's operator nor the AWS credentials can help: the portal returns "You
don't have access" for this registration, so it is entirely the tenant owner's fix. The
request to send them is in the Decision 1 section above.

Do not try to diagnose this by probing the `/authorize` endpoint. It returns a normal login
page for scopes that do not exist — verified by control, where a wholly fictional
`api://00000000-dead-beef-…/definitely_not_real` was equally "accepted". Entra defers scope
validation until after credentials, so the only signal is a real sign-in.

**Local workaround, so the rest stays testable:** `client/.env.gi.local` has
`VITE_API_AUTH_MODE` / `VITE_ENTRA_API_SCOPE` commented out.
`msalClient.getInteractionScopes()` appends the API scope to the *login* request, so leaving
them set fails sign-in before the redirect URI, tenant pin, or domain allowlist are ever
exercised. Without them login uses only `openid`/`profile`/`email`, which need no portal
work. The committed `client/env/staging/gi.env` is unchanged and still carries both.

**Not yet verified — needs an interactive NTU sign-in:**

1. That the redirect URIs are on the **SPA** platform, not Web (fails at redemption with
   AADSTS9002326, well after the login page looks fine).
2. That the exposed scope really is `api://9b5c52c0-…/access_as_user`, and whether the tenant
   demands admin consent for it.
3. That a genuine token passes verification and the socket reaches
   `session.authenticated` — everything above only proves bad tokens are rejected.
4. That a real conversation lands rows under `USER#<oid>`.

Until (3) is done, "the gate rejects everything" and "the gate is correctly configured" look
identical from the outside.

## Dev per-user behaviour checkpoint — 2026-08-06

The dev-first implementation now authenticates analytics, derives the immutable `oid`
server-side, maps recorded video behaviour to an authored GI concept timeline, aggregates
cautious evidence, stores learner summaries, retrieves the current user's summary for
chatbot teaching guidance, and exposes supervisor-role-protected user/detail endpoints plus
the `/supervisor` UI. Structured OpenAI summary generation is optional and falls back to
deterministic wording if its dedicated key is absent or the API fails.

Local tests/build pass, and `vcs-dev-transcripts` was created with the required GSI, TTL,
deletion protection, and tags. Deployment is intentionally paused: the operator cannot
grant the Lambda/gateway runtime access or enable point-in-time recovery. Exact grants and
the safe continuation order are recorded in `docs/staging-architecture.md` and project
memory.
