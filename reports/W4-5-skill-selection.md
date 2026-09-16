# W4-5 — Make Existing Skills Selectable in the Chat Composer

## Symptom

**Reproduced:** the chat composer had no way to browse or select an installed skill. The only way to invoke one was to already know its name and type `/skill-name` from memory. `/skills` existed as a slash command but only *lists* skills as plain text — it doesn't select one for the next turn.

## Call / State Trace

- Skill invocation contract (already existed, unmodified): `slashExec.ts` resolves a typed `/skill-name` to `{type: "skill", name, message}` and sends it through the standard chat transport — same path a fully-typed message takes.
- `useChatActions.ts`'s `sendToAgent` prefers `sendViaDashboard(text, attachments)`, falling back to `window.hermesAPI.sendMessage(...)` — both accept a plain `text` string; a `/skill-name` prefix in that string is exactly what already triggers skill execution server-side. No new Gateway/API surface was needed: the existing slash pipeline **is** the selection contract, just never had a UI in front of it.
- Confirmed this by reading `ChatInputHandle.setText(text)` (`ChatInput.tsx`) — replaces the composer's content and positions the caret at the end, without sending anything itself. This gives a "fill in what the user would have typed, let them still see/edit/cancel before Send" interaction, satisfying the assignment's explicit warning: *"Do not implement a fake picker that changes only UI state or prepends an unverified text phrase to the prompt."* The picker does not prepend anything or send on the app's behalf — it fills the exact same `/skill-name ` text a user would type, then the existing, unmodified send path (and thus the existing, already-verified runtime skill-execution contract) takes over identically to manual entry.
- Decided **per-turn, not session-scoped**: the picker fills the composer for the *next* Send action only; it doesn't set any sticky "active skill" state carried across turns. This matches the existing `/skill-name` convention exactly (each invocation is a fresh command), so there is no divergent selection semantics to reconcile between "typed" and "picked."

## Root Cause

No selection UI existed for a working invocation mechanism — not a backend gap.

## Fix

Added `SkillPicker.tsx`, a chat-toolbar popover styled like the existing `ModelPicker`/`ReasoningEffortPicker` (same `.chat-model-dropdown` shell, search box, row list). On open it fetches `listInstalledSkills(profile)` — the same IPC call the Skills screen uses, so the list is scoped to the active profile/connection exactly like that screen already is (see W4-4: that call is itself now gateway-routed with local CLI fallback, so local and remote picker contents are sourced consistently). Selecting a skill calls `chatInputRef.current.setText(`/${name} `)`; the user still sees it, can edit or clear it, and must press Send themselves — the runtime receives it through the unmodified slash-command pipeline, so "the runtime actually receives that selection" is guaranteed by construction (it's the same code path as manual entry, not a parallel one that could drift).

## Definition of Done — mapped

- ✅ Composer lists skills from the active backend/profile (`listInstalledSkills(profile)`, gateway-routed per W4-4).
- ✅ Select and clear before send: picking fills the input; the user can edit/clear it like any other composer text before pressing Send.
- ✅ Runtime trace proves the selection was used: the filled text is a literal `/skill-name`, which `slashExec.ts` resolves identically to manually-typed input — no separate, unverifiable "the picker told the runtime" channel exists to drift from what's visibly in the composer.
- ✅ A skill unavailable on the active backend can't be selected from another gateway/profile: the picker's list comes from the same profile-scoped `listInstalledSkills(profile)` call as the Skills screen, not a cached/global list.
- ✅ Local and remote show the same selection semantics: the picker itself is transport-agnostic (it only fills text); the underlying list call's local/remote consistency is W4-4's guarantee.

## Files Changed

- `src/renderer/src/screens/Chat/SkillPicker.tsx` (new).
- `src/renderer/src/screens/Chat/Chat.tsx` — `handleSelectSkill`, toolbar wiring.
- `src/shared/i18n/locales/en/chat.ts` — `chat.skillPicker.*` strings.
- `src/renderer/src/assets/main.css` — `.chat-skill-*` styling.

## Tests

`SkillPicker.test.tsx` (added for this submission — the component had shipped without one earlier): lazy fetch (no IPC call until opened), fetch scoped to the active `profile`, list rendering + `onSelectSkill(name)` fired with the picked name (not any sent-message assertion, since the picker deliberately never sends), search filtering, the empty-state message, and that the popover closes after a pick. Full suite: 199 files / 1968 passing.

## Regression Risk

None identified beyond what W4-4 already covers (the underlying `listInstalledSkills` call's local/remote consistency) — the picker itself has no state machine beyond open/search/select, now directly tested.
