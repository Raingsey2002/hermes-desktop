# W4-2 — Provider Switching Causes Agent Failure or Excessive Delay

## Symptom

**Reported:** switching providers/models from the chat composer may cause Agent initialization failure, stale credentials/base URL usage, or a much longer response path from repeated initialization, retries, reconnection, or partially-applied state.

**Reproduction attempted:** instrumented (by reading, since a live multi-provider account wasn't available in this environment) the full switch path: user selection → `slash.exec "/model ... --provider ..."` → readiness check → next prompt → first output, on both the dashboard transport and the legacy/CLI fallback, looking specifically for duplicate requests, unbounded retries, and unnecessary re-initialization.

## Call / State Trace

- `useDashboardChatTransport.ts#ensureSelectedModel` is the switch's entry point, called once per send from `sendMessage`.
- It keys an `appliedModelRef` cache (`${sessionId}\n${provider}\n${model}`) and **skips** the `slash.exec`/`model.options` round trip entirely when the key hasn't changed since the last successful switch — so a normal multi-turn conversation on a fixed provider does zero extra round trips per turn, not one.
- When the provider/model has changed (or the cache is cold), it does one `model.options` read, resolves the provider identity via `resolveDashboardProviderForModel` (handles the same-model-id-under-multiple-custom-providers ambiguity by base URL), issues one `slash.exec`, and re-reads `model.options` once to confirm — a bounded 2-3 round trips, not a storm.
- The one retry path (`overrideChangesRouting` crossing into/out of a `custom` provider) calls `resetRuntimeSession` (session.close + recreate) **once**, then re-attempts `switchAndValidate` **once** — bounded, not an unbounded loop. If it still can't confirm the live model matches, it throws with a descriptive error (`Hermes dashboard did not switch to ${provider}/${model}; live model is ...`) rather than silently proceeding on the wrong provider.
- `shouldForceCliForSessionOverride` (`hermes.ts:2452`) is the one place that meaningfully changes the *transport*, not just the model: on the legacy/CLI-eligible path (used when the dashboard transport is disabled, unavailable, or the user's preference is "Legacy"), **any** session override that changes `provider` or `baseUrl` from the persisted `config.yaml` default forces every message — not just the switch turn — onto a spawned CLI subprocess (`sendMessageViaCli`) instead of the persistent gateway/API connection, for as long as that override stays active.

## Root Cause

No retry-storm, duplicate-request, or unbounded-init bug was found in the dashboard transport's switch logic — it already has a cache-key guard and a single bounded retry. The one real, measurable overhead source is `shouldForceCliForSessionOverride`: it is **documented as intentional** ("Legacy CLI is only a safe session-override escape hatch for text-only turns," `hermes.ts:2438`) — a deliberate trade-off for provider/baseUrl combinations the API path can't route, not an oversight. It is a genuine per-message latency cost (subprocess spawn vs. a warm connection) on the legacy/auto transport specifically, not a defect to remove, since removing it would mean some cross-provider overrides have *no* working path on that transport at all.

## Fix

No code change made. This task's deliverable is the trace and root-cause determination above: the switch path is already atomic (validates before reporting success, via the `dashboardModelMatches` throw) and does not leave a half-switched session on failure — a failed `switchAndValidate` throws, which the caller surfaces as a chat error without mutating `appliedModelRef`, so the next attempt starts from the last **known-good** cache state rather than a corrupted one.

## Tests

No new tests required — this task did not change behavior. Confirmed via the existing test suite that the switch/dashboard-transport logic remains exercised and passing (`npx vitest run`, 199 files / 1968 passing).

## Timing Evidence

**Not collected.** Producing the required 3-run before/after timing table needs a live Hermes gateway with at least two configured providers actually reachable over the network, which this development environment does not have (no live provider credentials configured). Since no code changed for this task, there is no "before" vs. "after" to compare — the honest timing claim is: the switch-time overhead is 0 extra round trips on a same-provider turn (cache hit), ~2-3 round trips on a genuine switch (cache miss), and per-message CLI-subprocess spawn overhead only while an active session override forces the legacy transport off the persistent connection. A live run against real providers would be needed to turn those round-trip counts into wall-clock numbers; that verification is flagged as a manual step still owed for this submission.

## Regression Risk

None from this task — no code was changed. The risk being managed is *interpretive*: it would be easy to "fix" the CLI-fallback overhead by loosening `shouldForceCliForSessionOverride`'s condition, but doing so without understanding why it exists (per `model-selection.md`'s documented explanation) would silently break cross-provider switching for the provider combinations that condition exists to cover — exactly the kind of masking-with-a-workaround the assignment explicitly warns against ("Do not mask the problem with a longer timeout alone").
