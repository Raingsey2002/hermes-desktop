# W4-6 — Render and Complete Agent Confirmation Requests in Desktop UI

## Symptom

**Reproduced (read-trace, before any fix):** the agent's `approval.request` event, sent mid-turn before a flagged tool call, was never surfaced to the user on either transport that receives it in this codebase.

## Call / State Trace

- `src/main/hermes.ts#sendMessageViaTuiGateway` (dashboard transport): `event.type === "approval.request"` unconditionally answered `client.request("approval.respond", {session_id, choice: "once", all: false})` — approving whatever the agent wanted to do without ever asking the user. The comment above it said outright: *"Hermes One does not expose a mid-stream approval dialog."*
- `src/main/hermes.ts#sendMessageViaRuns` (runs/SSE transport): `eventName === "approval.request"` called `stopRunAndFallback()` — aborted the run and silently dropped the request.
- Neither path had any registry, IPC channel, or renderer component for approval — unlike `clarify.request`, which already had the full `pendingClarify` → `ChatCallbacks.onClarify` → `chat-clarify-request` IPC → `ClarifyCard.tsx` handshake.
- On the agent-runtime side (`~/.hermes/hermes-agent/tools/approval.py`, read-only — outside this repo, not modified): confirmed the real human-in-the-loop mechanism is `register_gateway_notify(session_key, cb)` / `_run_approval_gate`'s gateway branch, which blocks the agent thread on `entry.event.wait()` until `resolve_gateway_approval(session_key, choice, ...)` is called — "Called by the gateway's /approve or /deny handler to unblock waiting agent thread(s)."
- Also confirmed (read-only) the agent's own **smart approval** pre-filter: by default (`approvals.mode: "smart"` in `hermes_cli/config_defaults.py`), a flagged command is judged by an auxiliary LLM call (`_smart_approve`) that returns `approve`/`deny`/`escalate`; only `escalate` (or `mode: manual`) reaches the actual human gate. This explains why a first live test (a harmless `/tmp` file `rm`) got silently auto-approved by that pre-filter before any event could reach Desktop — not a Desktop bug, just a benign action the agent judged safe on its own.

## Root Cause

No Desktop UI or IPC channel existed for `approval.request` — both receiving transports converted a missing handler into an automatic or silent decision instead of pausing for a real one.

## Fix (code, shipped)

Added the same handshake shape `clarify.request` already had:
- `pendingApproval` registry (`registerPendingApproval`/`resolvePendingApproval`/`clearPendingApproval`) in `hermes.ts`, mirroring `pendingClarify`.
- `ChatCallbacks.onApproval`, wired through both stream handlers instead of the old unconditional/dropped responses. Dashboard now forwards the user's real decision to `approval.respond`; runs POSTs to `/v1/runs/{run_id}/approval` via the new `postRunApproval` (falling back to `stopRunAndFallback` only when there's truly no `request_id`/`run_id` to answer against).
- `chat-approval-request` / `approval-respond` IPC channels and preload bridge, mirroring the clarify channels exactly, including `safeSend`'s `runId`-prefix scoping.
- `ApprovalCard.tsx` (new inline transcript card), the `ApprovalMessage` message kind, wired through `useChatIPC.ts` (run-scoped via `eventMatchesRun`) and `MessageList.tsx`.
- `sessionHistory.ts`'s `repositionClarifyCards` generalized to `repositionInteractiveCards`, covering approval cards too.

Full detail and every path+symbol: `git log` for the `W4-6:` commit (`a5e7f7b`), and `lat.md/confirmation-ui.md`.

## Live Verification — What I Actually Found

I do **not** consider this task's live verification successful, and I'm reporting that plainly rather than rounding up.

Using a Playwright-driven build of the packaged app (`out/main/index.js`) against the real local gateway:

1. **First live attempt** (a harmless `rm` on a `/tmp` scratch file): the agent's own reply admitted *"The rm was flagged by the safety layer... and auto-approved by smart a[uto-approve]..."* — confirming the safety layer does flag actions, but this one was resolved by the agent's own pre-filter before any event reached Desktop. Expected behavior, not a bug in the fix.
2. To force a real escalation, I set the documented, operator-facing `approvals.smart_policy` config key (read-only research into `tools/approval.py` confirmed this is exactly the sanctioned customization point for this) to force every command to `ESCALATE`, restarted the gateway, and re-sent the same flagged command.
3. **Result: the agent thread visibly hung** — a persistent loading spinner with no further streamed output, exactly the shape of `_run_approval_gate`'s blocking `entry.event.wait()` — strongly suggesting the runtime *did* reach the real human-approval gate this time. **But no `ApprovalCard` ever rendered, and instrumenting `window.hermesAPI.onApprovalRequest` directly proved its callback never fired even once** (`window.__approvalEvents` stayed `[]` for the full 60-second observation window, confirmed via the actual IPC bridge, not just a CSS-selector check).

**Conclusion: there is a second, unresolved gap somewhere between the agent runtime's `register_gateway_notify` callback and Desktop's `onApproval`/IPC delivery that this session's fix does not close.** The two stream-handler branches I patched (`sendMessageViaTuiGateway`, `sendMessageViaRuns`) are demonstrably correct for the `approval.request` *event shape* they're written to handle — but this live session never hit either logged code path in a way I could confirm (no `[main stdout/stderr]` output was captured either), which means either a third delivery path exists that I haven't located, or the notify callback registration itself isn't reaching this particular session for a reason I haven't diagnosed. I did not have time remaining to chase this further in this session.

All test config changes were reverted (`approvals.smart_policy` removed from `config.yaml`, backed up and restored byte-for-byte) and all ad-hoc driver scripts/logs deleted; nothing test-related was committed.

## Tests

`pending-approval.test.ts` (registry bookkeeping) and `ApprovalCard.test.tsx` (8 cases) both pass — these correctly verify the code that exists. They cannot and do not prove the end-to-end wiring works, which is exactly what live testing above disproved.

## Regression Risk / Honest Status

**This task is NOT done.** The code fix targets a real, confirmed bug (the two unconditional-response/drop sites) and is a strict improvement over the prior behavior — but live testing surfaced a second gap in the delivery path that means a user may still never see an approval card in at least some sessions, which was the entire point of this task. The next debugging step, not yet taken: locate the actual dashboard/gateway client class or session-registration code that decides whether this session is a `"gateway"` approval context at all (`_is_gateway_approval_context()` on the agent side) and confirm the Desktop's WebSocket session is registering itself as one — the auto-approve/escalate distinction I found doesn't explain a *silent* drop with a hung agent thread and zero renderer signal.
