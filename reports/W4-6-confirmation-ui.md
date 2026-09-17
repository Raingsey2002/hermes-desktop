# W4-6 — Render and Complete Agent Confirmation Requests in Desktop UI

## Symptom

**Reproduced (read-trace, before any fix):** the agent's `approval.request` event, sent mid-turn before a flagged tool call, was never surfaced to the user on any of the transports that receive it in this codebase.

## Call / State Trace

There are **three** independent places an `approval.request` event can arrive, not two — this was the miss in the first pass of this fix.

- `src/main/hermes.ts#sendMessageViaTuiGateway` (main-process IPC dashboard transport): `event.type === "approval.request"` unconditionally answered `client.request("approval.respond", {session_id, choice: "once", all: false})` — approving whatever the agent wanted to do without ever asking the user. The comment above it said outright: *"Hermes One does not expose a mid-stream approval dialog."*
- `src/main/hermes.ts#sendMessageViaRuns` (runs/SSE transport): `eventName === "approval.request"` called `stopRunAndFallback()` — aborted the run and silently dropped the request.
- **`src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts` (renderer-side direct-WebSocket transport)** — the one actually in use whenever a local dashboard is running, which bypasses the main process's IPC transports entirely by connecting straight to the gateway's `/api/ws` endpoint via `dashboardGatewayClient.ts`. This code path had **zero** handling for `approval.request` at all: the event arrived, was accepted by `handleGatewayEvent`'s switch, and fell through with no case matching it — no card, no auto-response, nothing. This is the gap the first pass of this fix (documented in the previous version of this report) found live but didn't have time to close.
- Neither IPC path had any registry, IPC channel, or renderer component for approval — unlike `clarify.request`, which already had the full `pendingClarify` → `ChatCallbacks.onClarify` → `chat-clarify-request` IPC → `ClarifyCard.tsx` handshake.
- On the agent-runtime side (`~/.hermes/hermes-agent/tools/approval.py`, read-only — outside this repo, not modified): confirmed the real human-in-the-loop mechanism is `register_gateway_notify(session_key, cb)` / `_run_approval_gate`'s gateway branch, which blocks the agent thread on `entry.event.wait()` until `resolve_gateway_approval(session_key, choice, ...)` is called.
- Also confirmed (read-only) the agent's own **smart approval** pre-filter (`_run_approval_gate`, `tools/approval.py:3708-3733`): a flagged command only reaches `_smart_approve`/the human gate at all if it first matches a `DANGEROUS_PATTERNS` or Tirith rule — a harmless command like a bare `echo` never enters the approval machinery, gate or no gate. This tripped up the live-verification attempt below until a command matching an actual dangerous pattern (`chmod 777`) was used.

## Root Cause

No Desktop UI, IPC channel, or renderer-transport handling existed for `approval.request` on **any** of the three code paths that can receive it. Each converted a missing handler into an automatic decision (main-process dashboard transport), a silent drop (runs transport), or complete inaction (renderer's direct-WS transport) instead of pausing for a real user decision.

## Fix (code, shipped)

**Main-process transports** (`sendMessageViaTuiGateway`, `sendMessageViaRuns` in `hermes.ts`) — added the same handshake shape `clarify.request` already had: `pendingApproval` registry (`registerPendingApproval`/`resolvePendingApproval`/`clearPendingApproval`), `ChatCallbacks.onApproval` wired through both stream handlers instead of the old unconditional/dropped responses, `chat-approval-request`/`approval-respond` IPC channels and preload bridge (mirroring the clarify channels, including `safeSend`'s `runId`-prefix scoping), and `postRunApproval` (POST to `/v1/runs/{run_id}/approval`) for the runs transport.

**Renderer direct-WS transport** (`useDashboardChatTransport.ts`, the actually-live default path) — the real second fix, added after the first pass's live testing found the gap above:
- `dashboardEventAdapter.ts#appendApprovalRequest` builds a proper `ApprovalMessage` from the raw event payload (this transport's `approval.request` never carries a `request_id`, so a synthetic id is minted: `DASHBOARD_APPROVAL_ID_PREFIX + sessionId + timestamp`), wired into `applyDashboardStreamEvent`'s switch as `case "approval.request"`.
- `useDashboardChatTransport.ts` tracks the pending request's session id (`pendingApprovalSessionIdRef`) when the event arrives, clears loading/tool-progress state (mirroring the existing `clarify.request` handling immediately above it in `handleGatewayEvent`), and exposes a new `respondApprovalDirect(requestId, decision)` resolver that sends `client.request("approval.respond", {session_id, choice: decision, all: false})` straight over this connection's own WebSocket client — this transport is resolved by session id FIFO on the gateway side (`resolve_gateway_approval`), not by request id, since none exists here.
- `ApprovalCard.tsx` gained an optional `respond` prop (defaults to the existing `window.hermesAPI.respondApproval` IPC call) so the same card component works for both delivery paths without duplicating the UI.
- `Chat.tsx#handleApprovalRespond` routes each decision to the right transport by checking `requestId.startsWith(DASHBOARD_APPROVAL_ID_PREFIX)` — true means resolve via `dashboardTransport.respondApprovalDirect`, false means the request came from a main-process IPC transport and `window.hermesAPI.respondApproval` is correct.
- `sessionHistory.ts`'s `repositionClarifyCards` generalized to `repositionInteractiveCards`, covering approval cards from either origin.

Full detail and every path+symbol: `git log` for the `W4-6:` commits, and `lat.md/confirmation-ui.md`.

## Live Verification — Now Passing End-to-End

Using a Playwright-driven build of the packaged app (`out/main/index.js`, built with `VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG=1` for instrumentation) against the real local gateway, with the running `~/.hermes` gateway daemon still on its default `approvals.mode: smart`:

1. **First attempt** (a bare `echo` with a marker string): completed immediately, no approval card. Root-caused via `_run_approval_gate`'s source (§ Call/State Trace above) — a command must first match a `DANGEROUS_PATTERNS`/Tirith rule before smart-approval or the human gate is even consulted. A bare `echo` never enters that machinery, so this was the test command's fault, not the fix's.
2. Switched to a command that legitimately matches an existing dangerous pattern (`chmod 777 <tmp file>`, matching `"world/other-writable permissions"` in `tools/approval.py`'s `DANGEROUS_PATTERNS`), and set a temporary, backed-up `approvals.smart_policy` override in `~/.hermes/config.yaml` to force `ESCALATE` for that specific test command (rather than a blanket manual mode, so the rest of the live app kept its normal smart-approval behavior) — this is the documented operator customization point (`tools/approval.py#_get_smart_policy`), not a code change to the agent runtime.
3. **Result: the `ApprovalCard` rendered live**, with the correct flagged-pattern description ("world/other-writable permissions"), Approve/Deny/session/always buttons, screenshotted directly from the running app.
4. Clicked **Approve** — the card flipped to its resolved state ("Approved (once)"), the underlying `chmod 777` and the subsequent `echo` both ran (confirmed via the terminal tool-call transcript showing the marker string in the output), and the agent's own follow-up message explicitly named the approval flow: *"The tool flagged it: Command required approval (world/other-writable permissions) and was approved by the user — that's the `chmod 777` triggering the world-writable permission guard."*

This closes the gap the previous version of this report left open: the renderer's direct-WS transport is the one actually driving the packaged app by default, and it now renders and resolves a real `approval.request` end-to-end, not just in the two main-process IPC transports patched in the first pass.

All test config changes were reverted (`approvals.smart_policy` removed from `config.yaml`, restored byte-for-byte from a pre-edit backup diffed to confirm a clean revert) and all ad-hoc driver scripts/logs/marker files deleted; nothing test-related was committed.

## Tests

`pending-approval.test.ts` (registry bookkeeping, main-process transports) and `ApprovalCard.test.tsx` (8 cases, including the new `respond` prop override) both pass, plus `dashboardEventAdapter`'s existing suite covering the new `appendApprovalRequest`/`approval.request` case. Full suite: `npx vitest run` — 200 files / 1974 passing, 3 skipped. `npx tsc --noEmit` clean on both `tsconfig.web.json` and `tsconfig.node.json`. `eslint --max-warnings=0` clean on every touched file.

## Regression Risk

Low. The new renderer-side code is additive (a new adapter case, a new hook return value, an optional component prop with a safe default) and doesn't change behavior for any transport that isn't currently receiving an `approval.request` — a session that never sees one behaves identically to before. The one risk worth naming: `respondApprovalDirect` resolves by session id, not request id (this transport's event carries no request id), so if two approval requests were ever pending simultaneously on the same session, the second could be misattributed — in practice the agent's approval gate is a single blocking call per turn, so this can't currently happen, but it's a real constraint on the synthetic-id design if the gateway's approval model ever changes to allow concurrent requests.
