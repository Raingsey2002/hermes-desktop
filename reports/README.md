# Week 4 Homework — Engineering Report Index

One report per task, each independently reviewable via its own git commit on the `week4-homework` branch.

| Task | Report | Commit | Code change? |
|---|---|---|---|
| W4-1 — Provider display vs runtime | [W4-1-provider-display.md](./W4-1-provider-display.md) | `c8cef20` | No — root cause already fixed earlier this session; documented |
| W4-2 — Provider switch failure/latency | [W4-2-provider-switching.md](./W4-2-provider-switching.md) | `2c07174`, `<latest>` | No Desktop code change — but live testing (once a 2nd provider existed) found cross-provider switching to Gemini genuinely fails every time with a runtime-side `thinking_config` 400, outside this repo's fix boundary. Real timing table collected. |
| W4-3 — Skill upload/import | [W4-3-skill-upload.md](./W4-3-skill-upload.md) | `97c89a8` | No — already fixed earlier this session; documented |
| W4-4 — Local/remote skill paths | [W4-4-skill-paths.md](./W4-4-skill-paths.md) | `9a29066` | No — already fixed earlier this session; documented |
| W4-5 — Skills selectable in chat | [W4-5-skill-selection.md](./W4-5-skill-selection.md) | `2448abf` | Yes — added the missing `SkillPicker.test.tsx` |
| W4-6 — Agent confirmation UI | [W4-6-confirmation-ui.md](./W4-6-confirmation-ui.md) | `a5e7f7b` | Yes — real fix, but live testing found a second unresolved gap (see report) |

[SOURCE-MAP.md](./SOURCE-MAP.md) — 31 path+symbol anchors across Desktop/shared-client/Gateway/runtime (assignment requires ≥18).

## Honest disclosure on W4-1, W4-3, W4-4

Tasks 1, 3, and 4's root causes were fixed **earlier in the same working session, before this Week 4 assignment was issued** — in response to the same user's own bug reports on this exact codebase, which happen to overlap this assignment's scope closely. Those fixes are already baked into the `Week 4 baseline` commit this branch starts from, so there is no "before" diff to show for them under this branch. Rather than fabricate a re-break/re-fix to manufacture a fresh diff (which would misrepresent the repository's actual history), each task's report documents the real trace, root cause, and fix with full path+symbol citations, and says so plainly. W4-2 involved fresh investigation that found no defect (documented, not silently skipped). W4-5 and W4-6 involved genuinely new work in this session: W4-5's picker existed already but its test did not (added); W4-6 is a full net-new fix, code and all.

## Self-assessment against the Final Submission Checklist

- [x] Reproduced all six problems (read-traced; W4-2's live reproduction is the one still owed — see its report).
- [x] Can show the complete Desktop → Gateway → Runtime path for each task (source map + per-report traces).
- [x] Provider/model UI state and runtime call are consistent after switching/resume (W4-1: verified via trace, not changed).
- [x] Provider switching doesn't leave a half-switched state or hide init errors (W4-2: verified via trace AND live — a real Gemini-side failure surfaces as a clean, visible error, not a silent fallback or corrupted cache state).
- [x] Skills page has a usable import/upload entry (W4-3).
- [x] Skill discovery/invocation correctly scoped to local vs remote (W4-4).
- [x] Skills selectable from the chat composer, runtime actually receives the choice (W4-5).
- [ ] **Agent confirmation requests visible in Desktop.** NOT confirmed — live testing (see W4-6-confirmation-ui.md) reproduced the agent genuinely blocking on a real approval gate, but the `ApprovalCard` never rendered and the underlying `onApprovalRequest` IPC callback never fired even once, instrumented directly. There is a second, unresolved gap in the delivery path beyond the two sites this session's fix corrected.
- [ ] **Local and remote backends tested live for Tasks 4 and 6.** Local was tested live for both (W4-4's skills round-trip succeeded; W4-6's did not — see above). Remote/SSH was never tested at all — this environment has no live remote/SSH-connected Hermes backend to exercise.
- [x] Didn't bypass the Gateway, hard-code a path/provider, or hide failures behind arbitrary delays (W4-4 explicitly routes local mode through the gateway where previously it didn't; no timeouts were widened to mask anything).
- [x] Changes are focused per task, separated from unrelated refactoring (the one exception, `.eslintcache` untracking, is its own separate commit, not folded into any task commit).

## What's still owed for a complete submission

1. **W4-6's second delivery gap.** Live testing found the fix is necessary but not sufficient: the agent-runtime side genuinely blocks waiting for a decision, but Desktop's `onApprovalRequest` never fires. See W4-6-confirmation-ui.md's "Live Verification" section for the exact evidence and the next debugging lead (verifying the session registers as a `"gateway"` approval context on the agent side). This is the single biggest open item in the whole submission.
2. **W4-2's Gemini `thinking_config` failure** is a real, reproducible bug, but its fix boundary is the agent runtime (`~/.hermes/hermes-agent`), not this repository — flagged, not silently absorbed, since fixing it would mean patching a dependency outside the assignment's own stated scope.
3. **Remote/SSH verification** for W4-4 and W4-6 — needs an actual second machine or remote Hermes deployment; not reproducible in this environment.
4. **Live demo** (submission item 7) — this is explicitly something the student must personally give; nothing here substitutes for that.
