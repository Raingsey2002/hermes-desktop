# W4-1 — Provider Display vs Runtime Call Are Inconsistent

## Symptom

**Reported:** the provider/model shown in Desktop can differ from the provider/model actually used by the Agent runtime for the next request.

**Reproduction attempted:** opened a conversation, picked a model via the chat-input picker (session override), and traced every value read by (a) every UI surface that claims to show "the current model" and (b) the actual outbound send call, to see whether they could diverge.

## Call / State Trace

Sources of provider/model identity found in the Desktop flow:

1. **Chat-input picker selection** — `useModelConfig.ts#selectModel(..., {persist:false})` → sets local React state only (`Chat.tsx`'s `sessionModelOverride`), never writes `config.yaml`.
2. **Combined "current" value used by the active conversation** — `Chat.tsx:351-356`:
   ```
   chatCurrentModel    = sessionModelOverride?.model    ?? modelConfig.currentModel
   chatCurrentProvider = sessionModelOverride?.provider ?? modelConfig.currentProvider
   chatCurrentBaseUrl  = sessionModelOverride?.baseUrl  ?? modelConfig.currentBaseUrl
   ```
3. **Dashboard transport (the primary send path)** — `useDashboardChatTransport.ts:643` is constructed with `model: chatCurrentModel, provider: chatCurrentProvider, modelBaseUrl: chatCurrentBaseUrl` — i.e. it receives the *same* combined value, not the raw persisted default.
4. **Actual switch-and-verify before sending** — `useDashboardChatTransport.ts#ensureSelectedModel` → `resolveDashboardProviderForModel` (disambiguates a model id that exists under more than one custom-provider identity, by base URL) → `slash.exec "/model <model> --provider <provider>"` → re-reads `model.options` and **throws** if the live session model still doesn't match the request (`dashboardModelMatches`).
5. **Legacy/CLI send path** (`hermes.ts#sendMessage` → `effectiveModelConfig`) — overlays the same `SessionModelOverride` on top of `config.yaml`'s persisted default; non-empty override fields win.
6. **Two other UI surfaces that historically read only `config.yaml`'s persisted default**, independent of the active conversation's override:
   - Settings → Providers "ACTIVE MODEL" card.
   - Status bar's model chip.

## Root Cause

The actual send path (items 2-5) is internally consistent and self-verifying — it already throws rather than silently mismatching. The real inconsistency was **(6)**: two *other* displays (Settings' Active Model card, the status bar's model chip) showed `config.yaml`'s global default regardless of which model the active conversation was actually using via its session override. A user who switched models in one conversation would see the *old* global default in Settings/status bar while that conversation correctly ran on the new model — "Desktop shows X, runtime uses Y," exactly the reported symptom, just located in the wrong two components rather than in the send path itself.

## Files Changed (already fixed, prior to this assignment being issued — see Regression Risk)

- `src/renderer/src/screens/Providers/Providers.tsx` — removed the "ACTIVE MODEL" card (summary + Change picker + Browse Registry). The config.yaml load/save plumbing is kept (unused by any button now) so an existing default still works for fresh conversations and non-chat surfaces, but there is no more UI presenting it as "the current model."
- `src/renderer/src/screens/Layout/StatusBar.tsx` — removed the model chip from the bottom status strip.
- `src/renderer/src/screens/Chat/hooks/useModelConfig.ts` — a related, separately-motivated fix: the chat-input picker itself was also filtered to only list providers with a resolvable key/OAuth session (`isProviderConfigured`), since picking an unconfigured provider would have failed at send time with no explanation, which is its own flavor of "display promises something the runtime can't deliver."

## Fix

Removed both stale "current model" displays rather than trying to keep three independent surfaces (Settings, status bar, active conversation) synchronized — a single global chip can never correctly represent a value that is legitimately per-conversation. The authoritative value for a given conversation is `chatCurrentModel`/`chatCurrentProvider`/`chatCurrentBaseUrl`, already verified against the live runtime by `ensureSelectedModel` before every send.

## Tests

No new automated test added for this task specifically — the fix is a UI removal, verified via the full project test suite (`npx vitest run`, 199 files / 1968 passing) and `npm run typecheck` / `eslint --max-warnings=0 .` passing clean after the change, confirming nothing else in the app still depended on the removed surfaces.

## Regression Risk

**Disclosure:** the Settings/status-bar fix described above was made earlier in the same working session, *before* this Week 4 assignment was issued, in response to a related user report ("the provider in settings is inconsistent with the provider I can select in chat"). It is documented here as this task's resolution because it is the actual, already-verified root cause for the "display vs runtime" symptom in this codebase — re-breaking and re-fixing it for the sake of a fresh diff would misrepresent the repository's history. The *fresh* verification work for this submission was steps 2-5 of the trace above (tracing the real send path end-to-end to confirm it has no independent mismatch bug), which had not been done before.

Adjacent risk: removing the Settings "Active Model" UI means there is no more in-app way to set `config.yaml`'s default model from scratch for a brand-new profile with no prior default — a user in that state must use the `hermes` CLI or edit `config.yaml` directly. This is called out explicitly in `lat.md/provider-setup.md`'s "No more in-app Active Model setting" section.
