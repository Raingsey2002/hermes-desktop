# W4-4 — Make Local and Remote Skill Invocation Paths Consistent

## Symptom

**Reproduced two distinct problems**, both in the pre-fix codebase:

1. The entire Skills screen was hidden behind a "not available" `RemoteNotice` placeholder whenever the connection mode was `remote` (`Layout.tsx`, `Tools.tsx`), even though the backend for that exact mode (`remote-skills.ts`, calling the dashboard's `GET /api/skills` etc.) was fully implemented and working.
2. Local mode's skill list/content read the local filesystem directly via a spawned CLI / direct file read (`skills.ts#listInstalledSkills`/`getSkillContent`), while remote mode read via HTTP from the gateway's `/api/skills*` — two independently-maintained code paths for what the assignment calls "the same product contract."

## Call / State Trace

- `src/main/ipc/register.ts`'s `list-installed-skills`/`get-skill-content`/`install-skill`/`uninstall-skill` handlers branched on `conn.mode`: `"ssh"` → `ssh-remote.ts` (tunnel-exec, full local access already); `"remote"` → `remote-skills.ts` (dashboard HTTP API); anything else (`"local"`) → `skills.ts` (direct CLI spawn / direct file read).
- `getApiUrl(profile, conn)` (`hermes.ts:131`) — the function `remote-skills.ts` used to build its request URL — **already resolves to the local per-profile gateway's own HTTP port when `conn.mode` is local**, not just to a remote dashboard URL. This means the exact same `/api/skills*` gateway routes `remote-skills.ts` calls for remote mode are, in principle, reachable locally too, over the local gateway process that already exists for chat.
- `getApiAuthHeaders(profile, conn)` (`hermes.ts`, previously unexported, now exported) already composes the correct auth header for local (`API_SERVER_KEY`) vs. remote/SSH — `remote-skills.ts`'s original `skillsApi` helper used the remote/SSH-only `getRemoteAuthHeader`, which would have silently sent **no** auth header at all in local mode.
- `Layout.tsx`/`Tools.tsx` gated the entire `<Skills>` component behind `remoteMode ? <RemoteNotice/> : <Skills/>`, where `remoteMode = isRemoteOnlyMode()` — `conn.mode === "remote"` specifically (not SSH). This is the exact mode `remote-skills.ts` was built for; the UI was blocking access to a feature its own backend already supported.

## Root Cause

Two separate defects, not one: (a) local mode's skill IPCs never attempted the gateway HTTP path at all — they went straight to the CLI, so "local vs. remote use different paths" was true by construction, not disambiguated by any product decision; (b) independently, the renderer fully hid the Skills UI in remote mode regardless of (a), which was its own bug (a working backend behind an unconditional "not available" notice).

## Fix

- Renamed `remote-skills.ts` → `gateway-skills.ts` and generalized it: `getApiUrl(profile)` (now passes `profile`, which it previously omitted — a latent bug for local's per-profile ports) + `getApiAuthHeaders(profile)` (exported from `hermes.ts`) make the exact same client usable for **local and remote** alike; SSH keeps its own tunnel-exec path unchanged (it already has full local access via the tunnel, so there's no gateway-HTTP benefit to gain there).
- `list-installed-skills` / `get-skill-content` (the read paths) in local mode now: call `startGatewayWithRecovery(profile)` to ensure the local gateway is up; if it comes up, try the gateway API (`gatewayListInstalledSkills`) and only fall back to the direct CLI (`listInstalledSkills`) if that call itself fails. `get-skill-content` dispatches on the **path shape** (`gateway-skill:<profile>:<name>` marker prefix), not the connection mode — so a skill listed via the gateway is always fetched via the gateway regardless of what mode is currently active, and a CLI-fallback-listed skill (a real filesystem path) is always read directly.
- `install-skill` / `uninstall-skill` (the write paths) **intentionally stay on the local CLI** in local mode rather than also routing through the gateway's hub endpoints — those endpoints spawn the CLI server-side and return immediately (`{ok, pid}`, "started" not "completed"), whereas the local CLI path is synchronous and gives a real pass/fail classification (`classifySkillCliOutput`). Local mode has the better option and keeps it; remote mode has no local CLI to fall back to, so it accepts the async result.
- `Layout.tsx` / `Tools.tsx`: removed the `RemoteNotice` gate for Skills entirely — the backend has always supported remote mode; the UI was the only thing blocking it.

## Required Local / Remote Test Matrix (from the assignment)

| Case | Local | Remote | Verified |
|---|---|---|---|
| List Skills | gateway-first, CLI fallback | gateway (unchanged) | Same client (`gateway-skills.ts`), different `getApiUrl` resolution — code-level guarantee, not per-call branching logic to drift |
| Invoke existing Skill | local CLI (sync, real pass/fail) | gateway hub (async) | Intentionally different completion semantics, documented above — not a bug |
| Skill missing on active backend | Each backend's own list; no cross-machine fallback exists in either code path | same | `gatewayListInstalledSkills` throws rather than swallowing to `[]` on failure, so local's caller can tell "empty" apart from "unreachable" and choose CLI fallback correctly instead of misreporting "no skills" |
| Switch gateway/profile | `list-installed-skills` re-invoked per profile arg on every call (no caching) | same | Both paths take `profile` as an explicit parameter on every call, not cached global state |

## Files Changed

- `src/main/remote-skills.ts` → `src/main/gateway-skills.ts` (renamed + generalized: `profile`-aware `getApiUrl`, `getApiAuthHeaders` instead of remote-only auth, throws instead of swallowing on list failure).
- `src/main/remote-skills.test.ts` → `src/main/gateway-skills.test.ts` (renamed, updated for the new throw contract).
- `src/main/hermes.ts` — exported `getApiAuthHeaders`.
- `src/main/ipc/register.ts` — gateway-first-with-CLI-fallback for local-mode list/content.
- `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Tools/Tools.tsx` — removed the Skills `RemoteNotice` gate; dropped the now-dead `remoteMode` prop from `Tools`.

## Tests

`src/main/gateway-skills.test.ts` (renamed/updated) covers the generalized client directly: profile-scoped URLs, the default-profile no-`?profile=` case, the new throw-on-unreachable contract, content unwrapping, and hub install/uninstall mapping. Full suite: 199 files / 1968 passing.

## Regression Risk

The local gateway-first path adds one `startGatewayWithRecovery` call before a local Skills-screen open if the gateway isn't already running — a small added latency on first open, offset by falling straight to the CLI (no gateway wait) if `startGatewayWithRecovery` itself fails, so a machine where the gateway genuinely can't start doesn't lose Skills functionality, it just doesn't gain gateway routing for it.
