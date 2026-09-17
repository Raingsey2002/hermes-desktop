# Source Map

Path + symbol anchors traced during this submission, grouped by layer per the assignment's execution boundary (`Electron/React Desktop → apps/shared Gateway client → WebSocket JSON-RPC → hermes serve/tui_gateway → AIAgent/conversation runtime → provider/tools/skills → Gateway events → Desktop UI`). This repo's layering maps to that boundary as: **Desktop UI** = `src/renderer/src`, **Gateway client / transport** = `src/main/hermes.ts` + `src/main/ipc/register.ts` + `src/preload`, **Runtime/provider/skills contract** = the gateway RPC methods and REST endpoints those files call against (`hermes serve`'s API surface — `session.*`, `slash.exec`, `approval.*`, `clarify.*`, `/v1/runs/*`, `/api/skills*`).

## Provider display / switching (W4-1, W4-2)

1. `src/renderer/src/screens/Chat/Chat.tsx:351-356` — `chatCurrentModel`/`chatCurrentProvider`/`chatCurrentBaseUrl`, the session-override-over-default combined identity every downstream consumer reads.
2. `src/renderer/src/screens/Chat/hooks/useModelConfig.ts#selectModel` — the chat-input picker's `persist:false` session-only write path (issue #688 in-repo).
3. `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#ensureSelectedModel` — the switch-and-verify state machine (cache key, bounded retry, throw-on-mismatch).
4. `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#resolveDashboardProviderForModel` — disambiguates a model id shared by multiple custom-provider identities, by base URL.
5. `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts#dashboardModelMatches` — the live-model verification the switch throws against on mismatch.
6. `src/main/hermes.ts#shouldForceCliForSessionOverride` — the legacy-transport CLI-fallback condition, the one confirmed per-message latency source for cross-provider overrides.
7. `src/main/hermes.ts#effectiveModelConfig` — overlays a `SessionModelOverride` onto the persisted `config.yaml` model config for the legacy/API send path.
8. `src/renderer/src/screens/Providers/Providers.tsx` — former "Active Model" card (removed; was the actual display/runtime-divergent surface).
9. `src/renderer/src/screens/Layout/StatusBar.tsx` — former model chip (removed, same reason).
9b. `~/.hermes/hermes-agent` Gemini provider integration (read-only, outside this repo — exact file not isolated in this session) — the source of the live-reproduced `thinking_config` HTTP 400 on every Gemini turn post-switch; see W4-2's report for the full evidence.

## Skills — upload, path unification, chat selection (W4-3, W4-4, W4-5)

10. `src/main/skills.ts#installSkill` — the existing CLI install path (`hermes skills install <identifier> --yes`), confirmed via `--help` to accept a hub id or URL, never a local path.
11. `src/main/skills.ts#installSkillFromPath` — new local-file/folder install, bypassing the CLI entirely.
12. `src/main/gateway-skills.ts` (renamed from `remote-skills.ts`) — the generalized gateway HTTP client for skill list/content/install/uninstall, now usable in local mode as well as remote.
13. `src/main/hermes.ts#getApiUrl` — resolves to the local per-profile gateway port in local mode, the same function remote mode's URL resolution already used.
14. `src/main/hermes.ts#getApiAuthHeaders` (newly exported) — the local/remote/SSH-aware auth-header composer `gateway-skills.ts` now uses instead of the remote-only `getRemoteAuthHeader`.
15. `src/main/ipc/register.ts` — the `list-installed-skills`/`get-skill-content`/`install-skill`/`uninstall-skill` handlers' per-mode branching, including the new local gateway-first-with-CLI-fallback logic.
16. `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Tools/Tools.tsx` — removed `RemoteNotice` gate that hid Skills entirely in remote mode.
17. `src/renderer/src/screens/Chat/slashExec.ts` (`case "skill"`) — the existing skill-invocation contract the chat picker reuses unmodified.
18. `src/renderer/src/screens/Chat/SkillPicker.tsx` — the new chat-composer skill picker.
19. `src/renderer/src/screens/Chat/ChatInput.tsx#ChatInputHandle.setText` — the fill-not-send mechanism the picker uses to hand off to the existing send path.

## Confirmation UI (W4-6)

20. `src/main/hermes.ts#sendMessageViaTuiGateway` (dashboard transport's stream handler) — the `event.type === "approval.request"` branch, previously auto-answering unconditionally.
21. `src/main/hermes.ts#sendMessageViaRuns` (runs transport) — `handleRunEvent`'s `eventName === "approval.request"` branch, previously calling `stopRunAndFallback()` unconditionally.
22. `src/main/hermes.ts#registerPendingApproval` / `resolvePendingApproval` / `clearPendingApproval` — new pending-approval registry, mirroring the pre-existing `pendingClarify` map.
23. `src/main/hermes.ts#postRunApproval` — new POST to `/v1/runs/{run_id}/approval`, mirroring `postRunStop`'s shape.
24. `src/main/run-stream.ts#supportsHermesRunsTransport` — the capability gate (`run_approval_response`) confirming this endpoint is a real, documented contract.
25. `src/main/ipc/register.ts` — `onApproval` callback wiring (`safeSend("chat-approval-request", req)`) and the new `approval-respond` IPC handler.
26. `src/preload/index.ts#onApprovalRequest` / `#respondApproval` — the renderer bridge, mirroring `onClarifyRequest`/`respondClarify`.
27. `src/renderer/src/screens/Chat/hooks/useChatIPC.ts` — the `onApprovalRequest` listener, run-scoped via `eventMatchesRun` (same guard clarify uses) so a decision can't reach the wrong conversation.
28. `src/renderer/src/screens/Chat/ApprovalCard.tsx` — the new inline confirmation card.
29. `src/renderer/src/screens/Chat/sessionHistory.ts#repositionInteractiveCards` (generalized from `repositionClarifyCards`) — history-reconcile ordering fix, now covering both clarify and approval cards.
30. `src/renderer/src/screens/Chat/MessageRow.tsx` (`chat-approval-bar`, left unmodified) — the pre-existing legacy plain-text approval convention, distinct from the new structured card.

## Agent runtime (read-only — outside this repo, cited for the trace, never modified)

31. `~/.hermes/hermes-agent/tools/approval.py#_run_approval_gate` — the actual human-approval gate; the "gateway" branch is what blocks the agent thread until a real decision arrives.
32. `~/.hermes/hermes-agent/tools/approval.py#register_gateway_notify` / `resolve_gateway_approval` — the per-session callback registration and unblock-the-waiting-thread contract Desktop's IPC responses are meant to drive.
33. `~/.hermes/hermes-agent/tools/approval.py#_smart_approve` / `_get_smart_policy` — the auxiliary-LLM risk pre-filter (`approve`/`deny`/`escalate`) and its operator-customizable policy override, used during live testing to force a real escalation instead of a silent auto-approve.
34. `~/.hermes/hermes-agent/hermes_cli/config_defaults.py` (`approvals` block) — confirms `mode: "smart"` is the actual default (not `"manual"`, which is only the in-code fallback when no config is present at all).

34 real anchors total (assignment requires ≥18); 4 of these are read-only citations into the Agent-runtime layer the assignment's own execution boundary names, gathered during live debugging of W4-6's unresolved gap — not modified, since that layer is outside this repository.
