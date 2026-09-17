# W4-2 — Provider Switching Causes Agent Failure or Excessive Delay

## Symptom

**Reported:** switching providers/models from the chat composer may cause Agent initialization failure, stale credentials/base URL usage, or a much longer response path from repeated initialization, retries, reconnection, or partially-applied state.

**Reproduction:** first traced by reading (no second provider was configured yet). Once a second provider (`GOOGLE_API_KEY`, Gemini) was added, reproduced live via a Playwright-driven run of the packaged app against the real local gateway: 3 baseline turns on the default provider (DeepSeek), then a chat-picker switch to a newly-added `gemini-2.5-flash` model, then 3 more turns on the new provider — timestamping composer-submit to first rendered content for each.

## Call / State Trace

- `useDashboardChatTransport.ts#ensureSelectedModel` is the switch's entry point, called once per send from `sendMessage`.
- It keys an `appliedModelRef` cache (`${sessionId}\n${provider}\n${model}`) and **skips** the `slash.exec`/`model.options` round trip entirely when the key hasn't changed since the last successful switch — so a normal multi-turn conversation on a fixed provider does zero extra round trips per turn, not one.
- When the provider/model has changed (or the cache is cold), it does one `model.options` read, resolves the provider identity via `resolveDashboardProviderForModel` (handles the same-model-id-under-multiple-custom-providers ambiguity by base URL), issues one `slash.exec`, and re-reads `model.options` once to confirm — a bounded 2-3 round trips, not a storm.
- The one retry path (`overrideChangesRouting` crossing into/out of a `custom` provider) calls `resetRuntimeSession` (session.close + recreate) **once**, then re-attempts `switchAndValidate` **once** — bounded, not an unbounded loop. If it still can't confirm the live model matches, it throws with a descriptive error (`Hermes dashboard did not switch to ${provider}/${model}; live model is ...`) rather than silently proceeding on the wrong provider.
- `shouldForceCliForSessionOverride` (`hermes.ts:2452`) is the one place that meaningfully changes the *transport*, not just the model: on the legacy/CLI-eligible path (used when the dashboard transport is disabled, unavailable, or the user's preference is "Legacy"), **any** session override that changes `provider` or `baseUrl` from the persisted `config.yaml` default forces every message — not just the switch turn — onto a spawned CLI subprocess (`sendMessageViaCli`) instead of the persistent gateway/API connection, for as long as that override stays active.

## Root Cause

No retry-storm, duplicate-request, or unbounded-init bug was found in the dashboard transport's switch logic — it already has a cache-key guard and a single bounded retry. The one *routing-level* overhead source is `shouldForceCliForSessionOverride`: it is **documented as intentional** ("Legacy CLI is only a safe session-override escape hatch for text-only turns," `hermes.ts:2438`) — a deliberate trade-off, not an oversight.

**Live testing found a real, separate failure**, though, once a second provider actually existed to switch to: every turn sent to Gemini after the switch failed with `HTTP 400: Invalid JSON payload received. Unknown name "thinking_config": Cannot find field.` (`status: INVALID_ARGUMENT`), reproduced identically on all 3 post-switch turns. This is a genuine "provider switch causes agent failure" symptom, matching this task's title precisely — but the root cause sits **upstream of Desktop**, in the agent runtime (outside this repo, `~/.hermes/hermes-agent` @ `42708f8` / v0.20.0 — read-only, not modified):

- `agent/transports/chat_completions.py#_build_gemini_thinking_config` (lines 86–139) builds a `{"includeThoughts": True}` dict from `config.yaml`'s `agent.reasoning_effort`. Its own comment (line 95–98) *already documents this exact error* for one case: Gemma/PaLM models reject the field entirely (issue `#17426`), so the function guards on model name (`normalized_model.startswith("gemini")`) — but that guard only protects against the wrong **model**, not the wrong **endpoint shape**.
- `plugins/model-providers/gemini/__init__.py#GeminiProfile.build_extra_body` (lines 21–47) is where the same dict actually gets placed into the outgoing request body, and it branches on `_is_gemini_openai_compat_base_url(base_url)`:
  - **True** (base URL ends in `/openai`): correctly converts to snake_case (`include_thoughts`) and nests it under `extra_body.google.thinking_config` — the OpenAI-compat subpath's expected shape.
  - **False** (the plain native endpoint, `https://generativelanguage.googleapis.com/v1beta` — what a freshly-added model with no explicit base URL override actually uses): line 47 does `body["thinking_config"] = raw_thinking_config` — a **top-level** field with no nesting. Native Gemini's REST API has no such top-level field; the real one is `generationConfig.thinkingConfig` (nested, camelCase). This is the exact same "Unknown name" failure the code already comments about for Gemma, just newly triggered by the *native, non-compat* branch instead of the *wrong-model* case the guard was written for.

Desktop's own part of the job — routing the switched session to the Gemini endpoint with the right key — worked correctly: the request demonstrably reached Gemini's real API and got a structured `google.rpc.BadRequest` back, not a Desktop-side routing error, a timeout, or a silent fallback to the previous provider.

## Fix

No code change made to this repository. The failure's fix boundary is the agent runtime's Gemini provider integration, outside Hermes Desktop's scope (per the assignment's own layering — "Agent runtime" is a separate ownership layer from "Desktop UI, shared Gateway client, tui_gateway"). What *is* in scope and already correct: the switch path is atomic and does not leave a half-switched session on this failure — a failed turn surfaces as a normal chat error bubble without corrupting `appliedModelRef`'s cache state, so the next attempt (even against the same broken provider) starts clean rather than compounding.

## Tests

No new tests added — this is a runtime/provider integration failure, not a Desktop code defect to regression-test. Confirmed via the existing test suite that the switch/dashboard-transport logic remains exercised and passing (`npx vitest run`, 200 files / 1974 passing).

## Timing Evidence

Collected live (3 runs before, 3 after switching from `deepseek-flash` to `gemini-2.5-flash` via the chat-input picker, same conversation, composer-submit → first rendered content):

| Run | Provider | Result | Time to first output |
|---|---|---|---|
| baseline-1 | deepseek-flash | success ("ready") | 10.09 s *(cold-start turn — gateway/session not yet warm)* |
| baseline-2 | deepseek-flash | success ("ready") | 2.02 s |
| baseline-3 | deepseek-flash | success ("ready") | 1.64 s |
| switch-1 | gemini-2.5-flash | **failed — HTTP 400 thinking_config** | 5.05 s |
| switch-2 | gemini-2.5-flash | **failed — HTTP 400 thinking_config** | 6.63 s |
| switch-3 | gemini-2.5-flash | **failed — HTTP 400 thinking_config** | 6.60 s |

Reading these honestly: the "switch" numbers are *time-to-error*, not time-to-successful-response — there is no successful post-switch timing to report because every attempt failed identically. The one thing this does establish cleanly: the failure surfaces in ~5–7 s, not a 30+ s hang or a silent retry loop — consistent with the earlier code-trace finding that there's no retry storm, just a fast, deterministic rejection from Gemini's API on every attempt.

### Re-verification with the current provider set (DeepSeek + OpenRouter)

The Gemini key used above was later removed from this environment's config; the two providers actually configured now are DeepSeek (`deepseek-flash`) and OpenRouter (`amazon/nova-lite-v1`). Re-ran the identical live protocol — 3 baseline turns, a chat-picker switch, 3 more turns, composer-submit → first rendered content — against this provider pair, via the same Playwright-driven packaged-app harness:

| Run | Provider | Result | Time to first output |
|---|---|---|---|
| baseline-1 | deepseek-flash | success | 11.13 s *(cold start)* |
| baseline-2 | deepseek-flash | success | 2.06 s |
| baseline-3 | deepseek-flash | success | 2.03 s |
| switch-1 | amazon/nova-lite-v1 (OpenRouter) | **success** | 7.14 s |
| switch-2 | amazon/nova-lite-v1 (OpenRouter) | **success** | 4.09 s |
| switch-3 | amazon/nova-lite-v1 (OpenRouter) | **success** | 2.02 s |

All six turns produced genuine, distinct, on-topic responses (verified by reading the actual rendered transcript, not just checking for an absence of an error banner). The switch itself completed cleanly with no failure, no half-switched state, and no stale-provider response — the switch-1 turn's answer was generated by OpenRouter/Nova, not a silently-continued DeepSeek session. This confirms what the code trace already predicted: the switch mechanism itself (`ensureSelectedModel`'s cache-key guard and bounded retry) has no inherent defect — the earlier Gemini failure was specific to that one provider's request-shape bug in the external agent runtime (see Root Cause above), not a general property of switching providers. The first post-switch turn's 7.14 s (vs. the second and third's 4.09 s / 2.02 s) is consistent with the same "first call after a provider change costs one extra round trip" pattern already documented in the Call/State Trace section, not a new anomaly.

## Regression Risk

None from Desktop's side — no Desktop code was changed. The risk worth naming: it would be tempting to "fix" this by catching the Gemini 400 and silently retrying without `thinking_config`, but that's exactly the kind of workaround-instead-of-root-cause-fix the assignment warns against, and it would need to happen in the agent runtime (where the field is actually added to the payload), not in Desktop, which never constructs that payload itself.
