# Per-user chat transcript storage — design plan

**Status:** design agreed, not implemented.
**Related:** `docs/staging-architecture.md` (staging stack), `client/env/staging/gi.env` (SSO config, staged but **not deployed**).

## Decision log

Reviewed with the AWS/tenant owner on 2026-08-03. The approach below was confirmed as
matching how they would set it up themselves.

| Item | Outcome |
|---|---|
| Backend identity | **Option (ii), the API scope** — see Decision 1 |
| Redirect URIs | Being added to the app registration; ETA 2026-08-04 12:00 |
| DynamoDB table + IAM | Being provisioned by the same owner, same ETA. Probed 2026-08-03: this role has `dynamodb:ListTables` (no tables exist in ap-northeast-2 yet) but is denied `dynamodb:CreateTable` and `dynamodb:DescribeLimits`, so **table creation is his job too**, not just the role policy |
| MFA | Not required for this app |
| Token lifetime | ~24 h; not a constraint, identity is bound once at WS connect |
| Access policies | Satisfied — the gi build has no admin surface (`GiApp.jsx` omits admin routes) |
| **Retention** | **Still open** — see Retention and privacy |

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
  (`https://login.microsoftonline.com/45e82b6b-5ac4-41a7-a36f-e702e5e3a355/discovery/v2.0/keys`, keys cached)
- `iss` = `https://login.microsoftonline.com/45e82b6b-5ac4-41a7-a36f-e702e5e3a355/v2.0`
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
SK  SESSION#<sessionId>#META
    startedAt, email, displayName, lessonSlug, ttl

PK  USER#<oid>
SK  SESSION#<sessionId>#TURN#<seq, zero-padded>
    role ("user" | "assistant"), text, ts, voiceProfileId, [audioS3Key], ttl
```

- One user's whole history: `Query` on `PK = USER#<oid>`.
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

**Open — the one decision not yet settled.**

The tenant owner's position (2026-08-03) is that no TTL is needed and transcripts can be
kept indefinitely, on the grounds that the information is not especially sensitive.

That is true of the *lesson material*, which is not confidential. The concern is what
students volunteer into a free-text medical Q&A: in a GI-bleeding lesson some will describe
their own or a relative's symptoms. Tied to a verified NTU identity, that is health-adjacent
personal data about an identifiable individual, and PDPA's retention limitation says it
should not be held longer than the purpose requires.

Indefinite retention may still be the right answer — but as a deliberate decision by whoever
owns the data policy, not as a default. Escalate to the project supervisor if the tenant
owner does not want to make that call. A TTL costs nothing to set now and is painful to
retrofit once the table holds real student data.

Regardless of the outcome:

- Confirm whether student consent or IRB coverage is needed **before** any real student data
  is captured, not after.
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

1. **Purpose** — research export (dump to CSV afterward) or user-facing history (a student
   re-reads past chats)? The second needs a read API and UI; the first does not.
2. **Retention period** — becomes the `ttl` value.
3. **Audio** — text only, or keep the generated WAVs in S3 too?
4. **Scope** — GI kiosk only, or the chatbot surface as well?

## Implementation order

1. ~~Confirm the IAM permission is obtainable.~~ Agreed 2026-08-03; being provisioned.
2. *(Waiting on tenant owner, ETA 2026-08-04 12:00)* SPA redirect URIs registered
   (CloudFront **and** `http://localhost:5173`), API scope exposed, DynamoDB table and
   `dynamodb:PutItem` in place. Confirm the URIs are on the **SPA** platform, not Web.
3. Deploy the staged `gi.env` and verify sign-in works on staging end-to-end.
4. Client: switch to `VITE_API_AUTH_MODE=entra` + `VITE_ENTRA_API_SCOPE`, flip the
   `giPublicAccess.test.js` guard accordingly.
5. ~~Gateway: JWKS validation + bind identity at WS connect, behind a flag.~~ **Done** —
   `services/entraToken.js`, `services/liveChatAuth.js`, gate wired into
   `routes/liveChat.js`. Off unless `LIVE_AUTH_ENABLED=true`; 39 tests.
6. Load-test bypass — **gateway side done** (`LIVE_AUTH_LOADTEST_SECRET`, synthetic
   `LOADTEST#<n>` identity). `scripts/load-test-staging-chatbot.mjs` still needs to send the
   `session.auth` frame before auth is switched on.
7. ~~Per-turn DynamoDB writes.~~ **Done** — `services/transcriptStore.js` (item shape and
   keys, SDK-free and unit-tested), `services/dynamoTranscriptClient.js` (the only file that
   imports the AWS SDK, client built lazily), tapped off the bridge's `app-event` stream in
   `routes/liveChat.js`. Inert unless `TRANSCRIPT_TABLE_NAME` is set.
8. Read path, only if open question 1 is "user-facing history".

### Gateway env added by step 7

`TRANSCRIPT_TABLE_NAME` (empty disables storage entirely), `TRANSCRIPT_TABLE_REGION`
(default `ap-northeast-2`), `TRANSCRIPT_TTL_DAYS` (default `0` = no `ttl` attribute, so
nothing expires while retention is undecided), `TRANSCRIPT_STORE_SYNTHETIC` (default
`false`, so load-test rehearsals are not written).

Transcripts are only recorded on authenticated sessions — with `LIVE_AUTH_ENABLED=false`
there is no identity to attribute a turn to, so nothing is stored. The gateway also adds
`@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` (3 dependencies → 5), which means the
EC2 host needs an `npm install` at deploy.

### Table to create

```
Name     vcs-staging-transcripts
Region   ap-northeast-2
Keys     PK (S, HASH), SK (S, RANGE)
Billing  PAY_PER_REQUEST
TTL      attribute "ttl", enabled
```

Enabling TTL now costs nothing and settles the retrofit risk: items written without a `ttl`
attribute never expire, so the retention decision stays a config change rather than a
migration.

### Gateway env added by step 5

`LIVE_AUTH_ENABLED` (default `false`), `ENTRA_TENANT_ID`, `ENTRA_AUDIENCE` (the
`api://…` URI), `ENTRA_ALLOWED_EMAIL_DOMAINS`, `LIVE_AUTH_LOADTEST_SECRET` (empty disables
the bypass — it is never implied by enabling auth). Turning `LIVE_AUTH_ENABLED` on without
tenant and audience set is a startup failure, not a silent open door.

The client sends `{"type":"session.auth","token":"…"}` as its first frame and waits for
`{"type":"session.authenticated"}`. Failures close with 4401 (unauthorized), 4403
(forbidden — wrong domain, guest, wrong tenant) or 4408 (handshake timeout).

Steps 3-8 are all unblocked once step 2 lands. Nothing before then requires waiting —
gateway validation (5) and the load-test bypass (6) can be written and unit-tested against
a fixture token in the meantime.
