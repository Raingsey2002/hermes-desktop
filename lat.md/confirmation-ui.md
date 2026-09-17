# Agent confirmation requests

When the agent needs the user's go-ahead mid-turn (typically before running a flagged tool call), the gateway pauses and emits `approval.request` — Desktop must show it and return the decision, or the agent is left silently guessing.

## Structured approval card (W4-6)

Three transports can receive `approval.request` mid-stream, and none of them originally asked the user — each converted a missing UI handler into an automatic, silent, or absent decision.

The two main-process IPC transports either auto-answered unconditionally or silently dropped the request; the renderer's own direct-WebSocket transport — the one actually driving the packaged app whenever a local dashboard is running — had no handling for the event type at all, so it silently did nothing.

[[src/renderer/src/screens/Chat/ApprovalCard.tsx#ApprovalCard]] renders the request as an inline transcript card — the agent's message, the tool name when the request carried one, Approve/Deny buttons, plus one button per any extra `choices` the request supplied — mirroring [[src/renderer/src/screens/Chat/ClarifyCard.tsx#ClarifyCard]]'s shape (question/choices card, resolved-readonly state, delivery-failure guard) but kept as its own component and [[src/renderer/src/screens/Chat/types.ts#ApprovalMessage]] message kind, since approval and clarification are distinct gateway request types with different resolution semantics — a decision, not free-form text. It is distinct from the pre-existing legacy convention in [[src/renderer/src/screens/Chat/MessageRow.tsx]] (`chat-approval-bar`), which pattern-matches the agent's own reply text for phrases like "do you want me to proceed" and only appears once a turn has already finished — useful for a plain-text turn, but incapable of pausing a still-streaming run the way a real `request_id` handshake can.

The card doesn't assume how its decision gets delivered: an optional `respond` prop (defaulting to `window.hermesAPI.respondApproval`, the main-process IPC bridge) lets the caller substitute a different resolver for requests that arrived over a different transport — see "Direct-WebSocket transport" below.

### Pending-approval registry (W4-6)

Both transports needed a way to hand a mid-stream event to the renderer and later resume the paused gateway call with whatever the user decides — the same shape `pendingClarify` already solved for `clarify.request`.

[[src/main/hermes.ts#registerPendingApproval]] / [[src/main/hermes.ts#resolvePendingApproval]] / [[src/main/hermes.ts#clearPendingApproval]] are a one-shot resolver map keyed by `request_id`, structurally identical to the existing `pendingClarify` map. [[tests/pending-approval.test.ts]] covers the bookkeeping directly: fire-once, resolving an unknown or already-resolved id reports `false` (not-delivered) rather than throwing, and distinct ids resolve independently. `ChatCallbacks.onApproval` carries the request (`requestId`, `message`, optional `tool`, `choices`) from `hermes.ts` up through [[src/main/ipc/register.ts#registerIpcHandlers]]'s `safeSend("chat-approval-request", req)` — which, like the existing `chat-clarify-request` channel, automatically prefixes the event with `chatRunId` — through the `onApprovalRequest`/`respondApproval` preload bridge, into [[src/renderer/src/screens/Chat/hooks/useChatIPC.ts]]. There, `eventMatchesRun(eventRunId, runId)` (the same guard clarify uses) ensures a request can only be rendered into — and a decision only resolved against — the conversation it actually belongs to, never a different run.

The two previously-broken call sites now both resolve through this registry instead of answering unconditionally:

- **Dashboard transport** ([[src/main/hermes.ts#sendMessageViaTuiGateway]]'s stream handler, the `event.type === "approval.request"` branch): registers the pending approval and calls `cb.onApproval`, forwarding the user's real decision to `client.request("approval.respond", ...)` instead of the old hardcoded `{choice: "once", all: false}`. This event has been observed with no `request_id` on the dashboard protocol (unlike `clarify.request`, which always carries one) — a synthetic `session:<activeSessionId>` id keeps the registry and card working in that case, while the actual `approval.respond` call still uses the exact `{session_id, choice, all}` shape already proven to work, adding `request_id` only when the event supplied one.
- **Runs transport** ([[src/main/hermes.ts#sendMessageViaRuns]]'s `handleRunEvent`, same event type): registers the pending approval and calls `cb.onApproval` instead of `stopRunAndFallback()`; the resolver POSTs the decision to `/v1/runs/{run_id}/approval` via [[src/main/hermes.ts#postRunApproval]] (mirroring `postRunStop`'s request shape, gated by the same `run_approval_response` capability [[src/main/run-stream.ts#supportsHermesRunsTransport]] checks for). A request with no `request_id` (or arriving before a `run_id` is known) still falls back to `stopRunAndFallback()` — there's no id to answer against, so stopping is honest instead of hanging the agent on an approval that can never resolve.

### Direct-WebSocket transport (W4-6)

[[src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts]] connects straight to the gateway's WebSocket endpoint from the renderer process, bypassing the main-process IPC transports above entirely.

It does so via [[src/renderer/src/screens/Chat/dashboardGatewayClient.ts]], and is the transport actually in use by default whenever a local dashboard is running — so the two IPC-side fixes above alone left the common case unfixed.

[[src/renderer/src/screens/Chat/dashboardEventAdapter.ts#appendApprovalRequest]] builds an `ApprovalMessage` from the raw event payload as soon as it arrives (this transport's `approval.request` never carries a `request_id`, unlike the IPC transports' event shape, so a synthetic id is minted: `DASHBOARD_APPROVAL_ID_PREFIX + sessionId + timestamp`), wired into `applyDashboardStreamEvent`'s `case "approval.request"`. `useDashboardChatTransport.ts`'s `handleGatewayEvent` tracks the pending request's session id in `pendingApprovalSessionIdRef` (mirroring the existing `clarify.request` handling right above it) and exposes `respondApprovalDirect(requestId, decision)`, which sends `client.request("approval.respond", {session_id, choice, all: false})` directly over this connection's own client — the gateway resolves this call FIFO by session id (`resolve_gateway_approval` in the read-only agent runtime), not by request id, which is exactly why no real request id is needed or available here.

`handleApprovalRespond` in [[src/renderer/src/screens/Chat/Chat.tsx]] is the single place that decides which resolver a given card should use: `requestId.startsWith(DASHBOARD_APPROVAL_ID_PREFIX)` routes to `respondApprovalDirect`, anything else routes to the IPC bridge — the two paths can never answer each other's requests, so getting this dispatch right is what makes one `ApprovalCard` component work for both transports.

### Session-scoped card repositioning

Approval cards, like clarify cards, are renderer-only — never written to `state.db` — so a history reconcile after resume/reload would otherwise flush them to the wrong chronological slot.

[[src/renderer/src/screens/Chat/sessionHistory.ts#repositionInteractiveCards]] (generalized from the clarify-only `repositionClarifyCards`) re-anchors both card kinds immediately after the streamed message that preceded them, so a resumed session shows an approval card exactly where it appeared live rather than flushed below content the agent streamed afterward.
