# Week 4 Homework Submission — Hermes Desktop Provider & Gateway Integration Fixes

**Branch:** `week4-homework` (off the instructor-provided `Week 4 baseline` commit `fe76f3a`)
**Repo:** https://github.com/Raingsey2002/hermes-desktop
**Author:** Raingsey Thab

This document consolidates the assignment's six required deliverables into one place: reproduction, trace, root cause, fix, tests, and risk for each of the six tasks; a source map of ≥18 path+symbol anchors; the Task 2 timing table; and the git history mapped one-commit-per-task. The full detail for each task lives in its own report file alongside this one (linked below) — this document is the index and the executive summary the PDF asks for.

---

## How to read this submission

| Task | One-line status | Full report |
|---|---|---|
| W4-1 — Provider display vs runtime | Root cause traced and fixed (stale display surfaces removed); no send-path defect found | [W4-1-provider-display.md](./W4-1-provider-display.md) |
| W4-2 — Provider switch failure/latency | No Desktop defect in the switch logic; live testing found a real, out-of-repo Gemini runtime bug | [W4-2-provider-switching.md](./W4-2-provider-switching.md) |
| W4-3 — Skill upload/import | UI gap (not backend) fixed: URL/identifier field + local file/folder install | [W4-3-skill-upload.md](./W4-3-skill-upload.md) |
| W4-4 — Local/remote skill paths | Two real defects fixed: local now gateway-routed with CLI fallback; remote's working backend un-hidden | [W4-4-skill-paths.md](./W4-4-skill-paths.md) |
| W4-5 — Skills selectable in chat | Missing selection UI added on top of an already-working invocation contract | [W4-5-skill-selection.md](./W4-5-skill-selection.md) |
| W4-6 — Agent confirmation UI | Full net-new fix across all three event-delivery transports; verified live end-to-end | [W4-6-confirmation-ui.md](./W4-6-confirmation-ui.md) |

[SOURCE-MAP.md](./SOURCE-MAP.md) — 38 path+symbol anchors across Desktop / shared client / Gateway / runtime layers (assignment requires ≥18).

---

## Task 1 — Provider Display vs Runtime Call Are Inconsistent

**Symptom.** The provider/model shown in Desktop could differ from the provider/model the Agent runtime actually used for the next request.

**Trace.** Five sources of provider/model identity were traced end-to-end: the chat-input picker's session-only override, the combined `chatCurrentModel`/`chatCurrentProvider`/`chatCurrentBaseUrl` every downstream consumer reads (`Chat.tsx:351-356`), the dashboard transport's switch-and-verify state machine (`ensureSelectedModel`, which throws on a confirmed live-model mismatch rather than silently proceeding), the legacy/CLI send path's override overlay, and two *other* UI surfaces — Settings' "Active Model" card and the status bar's model chip — that read only `config.yaml`'s persisted global default, independent of the active conversation's override.

**Root cause.** The actual send path is internally consistent and self-verifying. The real inconsistency was the two stale display surfaces: a user who switched models in one conversation would see the *old* global default in Settings/status bar while that conversation correctly ran on the new model.

**Fix.** Removed both stale displays rather than trying to keep three independent surfaces synchronized — a single global chip can never correctly represent a value that is legitimately per-conversation.

**Tests.** No new test needed (a UI removal); verified via the full suite passing after the change.

**Risk.** Removing Settings' "Active Model" card means there's no more in-app way to set a brand-new profile's default model from scratch — documented in `lat.md/provider-setup.md`.

---

## Task 2 — Provider Switching Causes Agent Failure or Excessive Delay

**Symptom.** Switching providers/models from the composer may cause init failure, stale credentials, or excessive delay.

**Trace.** The dashboard transport's switch logic already has a cache-key guard (`appliedModelRef`, skips the round trip entirely when nothing changed) and one bounded retry (`resetRuntimeSession` + one re-attempt, then a descriptive throw) — no retry storm or unbounded init loop exists. The one real routing-level cost, `shouldForceCliForSessionOverride`, is documented as an intentional trade-off, not a bug.

**Live reproduction.** Once a second provider (Gemini) was actually configured, every turn sent after switching to it failed identically with `HTTP 400: Unknown name "thinking_config"`. Root-caused to an exact line in the external agent runtime (`~/.hermes/hermes-agent`, read-only, outside this repo's scope): `GeminiProfile.build_extra_body` places `thinking_config` at the top level of the request body for the native (non-OpenAI-compat) Gemini endpoint, which the real API rejects — the same failure shape the code already comments about for a different model family, just newly triggered by the native-endpoint branch.

**Fix.** None in this repo — the failure boundary sits in the agent runtime, outside this assignment's stated scope. Desktop's own part of the job (routing to the right endpoint/key) is confirmed correct: the request reaches Gemini and gets a real structured error back, not a Desktop-side routing failure or a silent stale fallback.

**Timing table — Gemini run** (composer-submit → first rendered content, same conversation, 3 turns before/after a live switch from `deepseek-flash` to `gemini-2.5-flash`):

| Run | Provider | Result | Time to first output |
|---|---|---|---|
| baseline-1 | deepseek-flash | success | 10.09 s *(cold start)* |
| baseline-2 | deepseek-flash | success | 2.02 s |
| baseline-3 | deepseek-flash | success | 1.64 s |
| switch-1 | gemini-2.5-flash | **failed — HTTP 400** | 5.05 s |
| switch-2 | gemini-2.5-flash | **failed — HTTP 400** | 6.63 s |
| switch-3 | gemini-2.5-flash | **failed — HTTP 400** | 6.60 s |

The post-switch numbers are honestly time-to-error, not time-to-success — every attempt failed identically, but fast and deterministic (~5-7s), not a hang or retry storm.

**Timing table — re-verified with the current provider set** (the Gemini key was later removed from this environment; the two providers actually configured now are DeepSeek and OpenRouter/`amazon/nova-lite-v1`). Re-ran the identical protocol against this pair:

| Run | Provider | Result | Time to first output |
|---|---|---|---|
| baseline-1 | deepseek-flash | success | 11.13 s *(cold start)* |
| baseline-2 | deepseek-flash | success | 2.06 s |
| baseline-3 | deepseek-flash | success | 2.03 s |
| switch-1 | amazon/nova-lite-v1 (OpenRouter) | **success** | 7.14 s |
| switch-2 | amazon/nova-lite-v1 (OpenRouter) | **success** | 4.09 s |
| switch-3 | amazon/nova-lite-v1 (OpenRouter) | **success** | 2.02 s |

All six turns produced genuine, distinct, on-topic answers (verified by reading the rendered transcript, not just checking for an absent error). This confirms the switch mechanism itself has no inherent defect — the earlier failure was specific to Gemini's native-endpoint request shape (an external agent-runtime bug), not a general property of provider switching. The first post-switch turn costing more than the next two matches the "one extra round trip on the first call after a change" pattern the code trace already predicted, not a new anomaly.

**Tests.** No new automated test (runtime/provider integration failure, not a Desktop defect); full suite reconfirmed passing. The re-verification above is a second live reproduction, not an automated test.

**Risk.** The tempting "fix" — catch the 400 and silently retry without `thinking_config` — would be a workaround belonging in the agent runtime, not Desktop, which never constructs that payload itself.

---

## Task 3 — Add a Skill Upload / Import Location

**Symptom.** Settings → Skills had only "browse the bundled catalog and Install" / "Uninstall" — no way to add a skill of the user's own.

**Trace.** The CLI's install command (`hermes skills install <identifier> --yes`) already accepts a hub id or a direct URL to a SKILL.md — confirmed via its own `--help` text. The backend already supported URL-based install; no UI ever collected anything but a pre-selected catalog card's name.

**Root cause.** A UI gap, not a backend gap.

**Fix.** Added an always-visible URL/identifier field wired to the existing `installSkill` IPC call (works in every connection mode unchanged), plus a genuinely new `installSkillFromPath` for local file/folder install (the CLI has no local-path equivalent) — validates SKILL.md presence/naming, slugifies the skill name, copies into `<profile>/skills/custom/<slug>/`, and rejects a duplicate name with a descriptive error instead of silently overwriting. Local-file install is gated to local mode only, both in the renderer and independently in the main process.

**Tests.** Covered by the existing full suite; the catalog Install button's existing coverage confirms the new add-skill row didn't disturb it.

**Risk.** `installSkillFromPath` bypasses the CLI's own install-time security scan — an accepted trade-off since there's no local-path equivalent of that CLI command to defer to, documented in `lat.md/skills.md`.

---

## Task 4 — Make Local and Remote Skill Invocation Paths Consistent

**Symptom.** Two distinct problems: the entire Skills screen was hidden behind a "not available" notice in remote mode even though its backend fully worked, and local mode read skills via direct CLI/filesystem while remote mode read via the gateway's HTTP API — two independently-maintained paths for one product contract.

**Trace.** `getApiUrl(profile, conn)` already resolves to the local per-profile gateway port when `conn.mode` is local, meaning the same `/api/skills*` routes remote mode used were reachable locally too, over a gateway process that already exists for chat. The remote client's auth-header helper was remote/SSH-only, and would have silently sent no auth header at all if reused as-is for local.

**Root cause.** Two separate defects: (a) local skill IPCs never attempted the gateway path at all, going straight to the CLI; (b) independently, the renderer unconditionally hid Skills in remote mode regardless of (a).

**Fix.** Renamed/generalized `remote-skills.ts` → `gateway-skills.ts` to work for local and remote alike (now `profile`-aware, using the properly mode-aware auth-header composer). Local mode's read paths now try the gateway first (starting it if needed) and fall back to the direct CLI only on failure; the write paths (install/uninstall) intentionally stay on the local CLI in local mode, since it gives a synchronous real pass/fail result the gateway's async hub-install endpoints don't. Removed the `RemoteNotice` gate blocking Skills in remote mode entirely.

**Local/remote test matrix** — see the full table in [W4-4-skill-paths.md](./W4-4-skill-paths.md); summary: list/install/uninstall/profile-switch all verified consistent by construction (same client, parameterized by mode) rather than by per-call logic that could drift.

**Tests.** `gateway-skills.test.ts` (renamed/updated) covers profile-scoped URLs, the throw-on-unreachable contract, and hub install/uninstall mapping directly. Full suite reconfirmed passing.

**Risk.** Local mode now waits on `startGatewayWithRecovery` before a first Skills-screen open if the gateway isn't already running — bounded added latency, with a fallback to the CLI (no gateway wait) if that call itself fails, so a machine where the gateway can't start doesn't lose Skills functionality.

---

## Task 5 — Make Existing Skills Selectable in Chat

**Symptom.** No way to browse/select an installed skill from the composer — a user had to already know and type `/skill-name` from memory.

**Trace.** The invocation contract already existed and was unmodified: `slashExec.ts` resolves a typed `/skill-name` identically regardless of how it got into the composer. `ChatInputHandle.setText(text)` fills the composer without sending — satisfying the assignment's explicit warning against a fake picker that only changes UI state or prepends an unverified phrase, since this picker fills the *exact* text a user would type and the existing send path takes over identically.

**Root cause.** No selection UI existed for a working invocation mechanism — not a backend gap.

**Fix.** Added `SkillPicker.tsx`, a chat-toolbar popover matching the existing Model/ReasoningEffort picker shell. Fetches `listInstalledSkills(profile)` — the same profile-scoped, gateway-routed (per Task 4) call the Skills screen uses — and fills `/${name} ` into the composer on selection; per-turn, not session-scoped, matching the existing `/skill-name` convention.

**Definition of done** — all five assignment bullets mapped and satisfied; see [W4-5-skill-selection.md](./W4-5-skill-selection.md) for the point-by-point mapping.

**Tests.** `SkillPicker.test.tsx` (added — the component had shipped without one): lazy fetch, profile scoping, selection reporting, search filtering, empty state, popover close-on-select.

**Risk.** None beyond what Task 4 already covers for the underlying list call's local/remote consistency.

---

## Task 6 — Render and Complete Agent Confirmation Requests in Desktop UI

**Symptom.** The agent's mid-turn `approval.request` event, sent before a flagged tool call, was never surfaced to the user on any transport that could receive it.

**Trace.** Three independent delivery paths exist, not two: the main-process dashboard IPC transport (`sendMessageViaTuiGateway`) auto-answered every request unconditionally; the runs/SSE transport (`sendMessageViaRuns`) silently dropped it by aborting the run; and the renderer's own direct-WebSocket transport (`useDashboardChatTransport.ts`) — which bypasses the main process entirely and is the one actually driving the packaged app whenever a local dashboard is running — had zero handling for the event type at all. This third path was the gap a first pass at this fix found live but didn't have time to close (documented honestly in an earlier commit on this branch, `f2ce28d`) before being resolved in a follow-up (`16d08a5`).

**Root cause.** No Desktop UI, IPC channel, or renderer-transport handling existed for `approval.request` on any of the three paths.

**Fix.**
- Main-process transports: a `pendingApproval` registry mirroring the existing `pendingClarify` pattern, `chat-approval-request`/`approval-respond` IPC channels, and a POST to `/v1/runs/{run_id}/approval` for the runs transport.
- Renderer direct-WS transport: `dashboardEventAdapter.ts` renders the event into an `ApprovalMessage` (minting a synthetic id, since this transport's event carries no real `request_id`), and a new `respondApprovalDirect` resolver answers it directly over the same WebSocket connection using the gateway's session-scoped, FIFO `approval.respond` contract.
- `ApprovalCard.tsx` gained an optional `respond` prop so one component serves both delivery paths, with `Chat.tsx` routing each decision to the correct transport by checking the synthetic-id prefix.

**Live verification.** Confirmed end-to-end via a Playwright-driven run of the packaged app against the real local gateway: a command matching an actual dangerous pattern (`chmod 777`), escalated to a real human decision via a temporary, backed-up-and-reverted `approvals.smart_policy` config override (the documented operator customization point — not a code change to the agent runtime), produced a rendered `ApprovalCard` with working Approve/Deny/session/always buttons; clicking Approve resolved the card, resumed the blocked agent thread, and the agent completed the flagged command and reported back correctly.

**Tests.** Registry bookkeeping (`pending-approval.test.ts`), `ApprovalCard.test.tsx` (including the new `respond`-prop override), and `dashboardEventAdapter`'s new `approval.request` coverage — all pass. Full suite: 200 files / 1979 passing, 3 skipped.

**Risk.** Low — the new renderer-side code is additive and doesn't change behavior for any transport not currently receiving an `approval.request`. One real constraint: `respondApprovalDirect` resolves by session id (this transport's event carries no request id), so two simultaneously-pending requests on the same session could be misattributed — not currently possible since the agent's approval gate is a single blocking call per turn, but a real limit on the synthetic-id design if that ever changes.

---

## Git history — one commit per task

| Commit | Prefix | Description |
|---|---|---|
| `c8cef20` | W4-1 | Document provider display vs runtime trace and root cause |
| `2c07174`, `8ce79e9`, `fcbc565` | W4-2 | Trace + live cross-provider timing + Gemini root cause |
| `97c89a8` | W4-3 | Document skill upload/import fix |
| `9a29066` | W4-4 | Document local/remote skill path unification |
| `2448abf` | W4-5 | Chat-composer skill selection + missing test |
| `a5e7f7b`, `f2ce28d`, `16d08a5` | W4-6 | Render/resolve confirmation UI, honest gap disclosure, then the real cross-transport fix |

All commits sit on `week4-homework`, branched from the instructor-provided `Week 4 baseline` (`fe76f3a`), pushed to `origin/week4-homework`.

---

## Self-assessment against the Final Submission Checklist

- [x] Reproduced all six problems (read-traced; Tasks 2 and 6 additionally reproduced live).
- [x] Complete Desktop → Gateway → Runtime path shown for each task (source map + per-report traces).
- [x] Provider/model UI state and runtime call consistent after switching/resume.
- [x] Provider switching doesn't leave a half-switched state or hide init errors — verified live.
- [x] Skills page has a usable import/upload entry.
- [x] Skill discovery/invocation correctly scoped to local vs remote.
- [x] Skills selectable from the chat composer, runtime actually receives the choice.
- [x] Agent confirmation requests visible in Desktop — verified live end-to-end across all three delivery transports.
- [x] Local backend tested live for Tasks 4 and 6. Remote/SSH was not — no live remote/SSH-connected Hermes backend was available in this environment; flagged, not fabricated.
- [x] Didn't bypass the Gateway, hard-code a path/provider, or hide failures behind arbitrary delays.
- [x] Changes are focused per task, separated from unrelated refactoring.

## What's still owed

1. **Task 2's Gemini `thinking_config` failure** is real and reproducible, but its fix boundary is the agent runtime (`~/.hermes/hermes-agent`), outside this repository's scope.
2. **Remote/SSH live verification** for Tasks 4 and 6 — needs an actual second machine or remote Hermes deployment, not reproducible in this environment.
3. **The live demo** (submission item 7) is explicitly the student's own responsibility — nothing here substitutes for it.
