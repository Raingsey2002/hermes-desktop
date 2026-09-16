# Week 4 Homework — Engineering Report Index

One report per task, each independently reviewable via its own git commit on the `week4-homework` branch.

| Task | Report | Commit | Code change? |
|---|---|---|---|
| W4-1 — Provider display vs runtime | [W4-1-provider-display.md](./W4-1-provider-display.md) | `c8cef20` | No — root cause already fixed earlier this session; documented |
| W4-2 — Provider switch failure/latency | [W4-2-provider-switching.md](./W4-2-provider-switching.md) | `2c07174` | No — traced, no defect found; timing table not collected (no live gateway) |
| W4-3 — Skill upload/import | [W4-3-skill-upload.md](./W4-3-skill-upload.md) | `97c89a8` | No — already fixed earlier this session; documented |
| W4-4 — Local/remote skill paths | [W4-4-skill-paths.md](./W4-4-skill-paths.md) | `9a29066` | No — already fixed earlier this session; documented |
| W4-5 — Skills selectable in chat | [W4-5-skill-selection.md](./W4-5-skill-selection.md) | `2448abf` | Yes — added the missing `SkillPicker.test.tsx` |
| W4-6 — Agent confirmation UI | (see `git log` for `W4-6:` commit) | `a5e7f7b` | Yes — full fix, new code |

[SOURCE-MAP.md](./SOURCE-MAP.md) — 31 path+symbol anchors across Desktop/shared-client/Gateway/runtime (assignment requires ≥18).

## Honest disclosure on W4-1, W4-3, W4-4

Tasks 1, 3, and 4's root causes were fixed **earlier in the same working session, before this Week 4 assignment was issued** — in response to the same user's own bug reports on this exact codebase, which happen to overlap this assignment's scope closely. Those fixes are already baked into the `Week 4 baseline` commit this branch starts from, so there is no "before" diff to show for them under this branch. Rather than fabricate a re-break/re-fix to manufacture a fresh diff (which would misrepresent the repository's actual history), each task's report documents the real trace, root cause, and fix with full path+symbol citations, and says so plainly. W4-2 involved fresh investigation that found no defect (documented, not silently skipped). W4-5 and W4-6 involved genuinely new work in this session: W4-5's picker existed already but its test did not (added); W4-6 is a full net-new fix, code and all.

## Self-assessment against the Final Submission Checklist

- [x] Reproduced all six problems (read-traced; W4-2's live reproduction is the one still owed — see its report).
- [x] Can show the complete Desktop → Gateway → Runtime path for each task (source map + per-report traces).
- [x] Provider/model UI state and runtime call are consistent after switching/resume (W4-1: verified via trace, not changed).
- [x] Provider switching doesn't leave a half-switched state or hide init errors (W4-2: verified via trace).
- [x] Skills page has a usable import/upload entry (W4-3).
- [x] Skill discovery/invocation correctly scoped to local vs remote (W4-4).
- [x] Skills selectable from the chat composer, runtime actually receives the choice (W4-5).
- [x] Agent confirmation requests visible in Desktop, response returns to the correct session (W4-6).
- [ ] **Local and remote backends tested live for Tasks 4 and 6.** Not done — this environment has no live remote/SSH-connected Hermes backend to exercise. Code-level guarantees (same client, `eventMatchesRun`/marker-path scoping) are documented per task; an actual live run against both backends is the one manual verification step still owed before submission.
- [x] Didn't bypass the Gateway, hard-code a path/provider, or hide failures behind arbitrary delays (W4-4 explicitly routes local mode through the gateway where previously it didn't; no timeouts were widened to mask anything).
- [x] Changes are focused per task, separated from unrelated refactoring (the one exception, `.eslintcache` untracking, is its own separate commit, not folded into any task commit).

## What's still owed for a complete submission

1. **Live local/remote/SSH verification** for W4-4 and W4-6 (the checklist item above) — needs an actual running gateway in both modes.
2. **W4-2 timing table** — needs a live multi-provider setup to produce real switch-to-ready / prompt-to-first-output numbers; the report explains why it wasn't fabricated instead.
3. **Live demo** (submission item 7) — this is explicitly something the student must personally give; nothing here substitutes for that.
