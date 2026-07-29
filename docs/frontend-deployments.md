# Frontend Deployments — which build goes where

**Question this answers:** "I run `npm run build:gi` for d2o. What do I run for d25?"
**Answer:** `npm run build:chatbot`. They are different Vite *modes*, not the same build pointed at two backends.

**Last verified:** 2026-07-29 (from repo sources; AWS not reachable — see [§6](#6-what-is-not-verified)).

---

## 1. The two live surfaces

| | Dev | Staging |
|---|---|---|
| CloudFront domain | `d2o0cbe2zunqkr.cloudfront.net` | `d25sg72wp8oj5g.cloudfront.net` |
| What you see | GI lesson page (video + transcript + chat) | "Live Voice Chat" kiosk (Assistant Instructions panel) |
| **Vite mode** | **`gi`** | **`chatbot`** |
| **Build command** | **`npm run build:gi`** | **`npm run build:chatbot`** |
| Output dir | `client/dist-gi` | `client/dist-chatbot` |
| S3 prefix | `echolect/dist-gi` | `echolect-staging/dist-chatbot` |
| Distribution ID | `EYZ4NLNGITY7T` | `E3MLIO4CZFOPEO` |
| GPU EC2 | `i-03f258d470a2fa73f` (SSH) | `i-0f0da8be59367f7a8` (SSM) |
| Lambda | `…-Voice_Cloning_Project` | `…-Voice_Cloning_Project-staging` |

Bucket for both: `interns2026-small-projects-bucket-shared`, region `ap-southeast-1`.

### Why they can coexist

Modes are a **build-time** switch, resolved once in `client/src/App.jsx`:

```jsx
{APP_MODE_CONFIG.gi ? <GiApp /> : <AppShell />}
```

`client/src/lib/appMode.js` defines the full set: `combined`, `training`, `live-fast`, `chatbot`, `gi`. Because each mode has its **own `outDir` and its own S3 prefix**, building one can never overwrite another. There is no isolation work to do — it is already structural.

---

## 2. All build modes

| Mode | Build command | Output | Env file |
|---|---|---|---|
| `gi` | `npm run build:gi` | `dist-gi` | `client/.env.gi` |
| `chatbot` | `npm run build:chatbot` | `dist-chatbot` | `client/.env.chatbot` |
| `training` | `npm run build:training` | `dist-training` | `client/.env.training` |
| `live-fast` | `npm run build:live-fast` | `dist-live-fast` | `client/.env.live-fast` |
| `combined` | `npm run build` | `dist` | `client/.env` |

> **`npm run build` is not what ships.** Plain `build` produces `dist/`, which nothing deploys. Always use the mode build.

---

## 3. How to deploy

### Dev — GI page (d2o)

```powershell
pwsh client/scripts/deploy-gi.ps1
```

Builds `gi`, syncs `client/dist-gi` → `echolect/dist-gi` (hashed assets `immutable`, `index.html` `no-cache`), then invalidates the distribution. One command, run locally with your own AWS credentials.

There is a matching `client/scripts/deploy-chatbot.ps1` for the Dean kiosk at `echolect/dist-chatbot` — **but read [§4](#4-the-dev-origin-path-trap) before using it.**

### Staging — chatbot kiosk (d25)

There is **no** staging deploy script on `chatbot-live-full`. The generic script lives on `separate-containers-new`:

```powershell
pwsh scripts/deploy-client.ps1 -Env staging -Mode chatbot
```

It copies `client/env/staging/chatbot.env` → `client/.env.chatbot.local`, runs `build:chatbot`, syncs to `echolect-staging/dist-chatbot`, invalidates `E3MLIO4CZFOPEO`.

Three things will block you:

1. **The script and its env files are not on `chatbot-live-full`.** `scripts/deploy-client.ps1`, `scripts/deploy.config.json`, and the whole `client/env/` tree exist only on `separate-containers-new`.
2. **It refuses to build `chatbot` off the wrong branch.** It compares `git branch --show-current` against `chatbotBranch`, which is `staging-chatbot` for staging.
3. **`staging-chatbot` is stale.** It is a clean ancestor of `chatbot-live-full`, 34 commits behind as of 2026-07-29 — so it fast-forwards, but until you do, staging ships without recent client work.

Do **not** run a bare `npm run build:chatbot` from `chatbot-live-full` and upload it. That branch's `client/.env.chatbot` has **empty** backend URLs:

```
VITE_API_BASE_URL=
VITE_GPU_WORKER_URL=
VITE_LIVE_GATEWAY_URL=
```

Staging needs them pointed at `https://d25sg72wp8oj5g.cloudfront.net`, which is what `client/env/staging/chatbot.env` supplies.

---

## 4. The dev origin-path trap

On dev, **`gi` and `chatbot` are served by the same CloudFront distribution** (`EYZ4NLNGITY7T` / `d2o0cbe2zunqkr`) from two different S3 prefixes. The distribution's **origin path** decides which one users actually get.

```
                      ┌─ echolect/dist-gi       ← origin path points here (as of 2026-07-24)
d2o0cbe2zunqkr ───────┤
  (EYZ4NLNGITY7T)     └─ echolect/dist-chatbot  ← still written, but not served
```

Consequence: **deploying the mode the origin path does not point at succeeds silently and changes nothing.** The S3 sync returns 0, the invalidation returns 0, and the site is unchanged. `client/scripts/deploy-gi.ps1` carries this warning in its header for exactly this reason.

Before concluding a dev deploy "didn't work", check the origin path:

```bash
aws cloudfront get-distribution-config --id EYZ4NLNGITY7T \
  --query "DistributionConfig.Origins.Items[*].[Id,OriginPath]" --output text
```

Staging does not have this problem — its chatbot distribution has its own prefix.

---

## 5. Which branch has which frontend

| | `chatbot-live-full` | `separate-containers-new` |
|---|---|---|
| `gi` mode + `client/src/components/gi/*` | ✅ | ❌ **absent entirely** |
| `chatbot` mode | ✅ | ✅ |
| `client/env/{dev,staging}/*` | ❌ | ✅ |
| `scripts/deploy-client.ps1` + `deploy.config.json` | ❌ | ✅ |
| `client/scripts/deploy-gi.ps1`, `deploy-chatbot.ps1` | ✅ | ❌ |

The split is deliberate. Commit `902569f` on `separate-containers-new` states the policy: *"Keep client tree isolated; backport is gateway-only."* Backend fixes flow into `separate-containers-new`; the client tree does not.

**Practical effect:** you cannot cherry-pick a gi commit onto `separate-containers-new` — the files it touches do not exist there. Unifying the two frontends onto one branch requires a full merge (13 conflicting files as of 2026-07-29), not a cherry-pick.

There is **no `gi` entry in `deploy.config.json`**, so `deploy-client.ps1 -Mode gi` is not a valid invocation. GI deploys go through `client/scripts/deploy-gi.ps1` only, and only to dev.

---

## 6. What is *not* verified

Everything above was read from repo sources on 2026-07-29. AWS was **not** reachable at the time (expired session token), so no ID or origin path was confirmed against the live account.

**Known inconsistency — resolve before trusting either:**

| Source | Claims dev chatbot domain is |
|---|---|
| `docs/dev-environment-duplication-guide.md:66` | `EYZ4NLNGITY7T` / **`d2o0cbe2zunqkr`** |
| `docs/staging-architecture.md:45` | **`d3fwx6qxeaxfmo.cloudfront.net`** |

This file follows the duplication guide, because it pairs the ID and domain in one row and agrees with `deploy-chatbot.ps1` (`$CloudFrontDomain = 'd2o0cbe2zunqkr'`) and with `deploy.config.json` (`dev.distributions.chatbot = EYZ4NLNGITY7T`, target `echolect/dist-chatbot`). `d3fwx6qxeaxfmo` may be an older dev chatbot distribution, or the line may simply be stale. **Confirm with `aws cloudfront list-distributions` before relying on it.**

Also unconfirmed: whether d2o's origin path is *still* `/echolect/dist-gi`. It was as of the `deploy-gi.ps1` header comment, last touched 2026-07-24 in `bd7a34d`.

---

## Related

- `docs/staging-architecture.md` — full staging inventory (ALB, listener rules, VPC, Lambda)
- `docs/dev-environment-duplication-guide.md` — how the dev environment was built
- `CLAUDE.md` → "Commands" — per-component dev servers and builds
