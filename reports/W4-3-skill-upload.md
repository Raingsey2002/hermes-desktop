# W4-3 — Add a Skill Upload / Import Location

## Symptom

**Reproduced:** Settings → Capabilities → Skills had exactly two actions available — browse the bundled catalog and click Install on a card, or Uninstall an already-installed skill. There was no field, button, or dialog anywhere to add a skill of the user's own (a URL, a hub identifier not in the catalog, or a local SKILL.md).

## Call / State Trace

- `src/renderer/src/screens/Skills/Skills.tsx` (pre-fix) called `window.hermesAPI.installSkill(name, profile)` only from the bundled-catalog card's Install button — `name` was always a catalog entry's `skill.name`, never user-supplied.
- `installSkill(identifier, profile)` (`src/main/skills.ts`) shells out to `hermes skills install <identifier> --yes`. Checked the CLI's own `--help` output directly: `identifier` accepts **"a hub identifier (e.g. openai/skills/skill-creator) or a direct HTTP(S) URL to a SKILL.md file"** — the backend already supports installing from an arbitrary URL; the UI simply never exposed a text field to type one into.
- The CLI does **not** accept a local filesystem path (confirmed from the same `--help` text: only `identifier` — a hub id or URL — is a valid positional argument), so a "local file" install needs a different mechanism entirely; see Fix below.

## Root Cause

A UI gap, not a backend gap: `installSkill`'s IPC/CLI contract already supported URL-based install; no component in `Skills.tsx` ever collected a value other than a pre-selected catalog card's name to pass to it.

## Fix

- **URL/identifier field:** added an always-visible "add skill" row to `Skills.tsx` (`skills-add-row`) — a free-text input plus an Install button wired to the *existing* `installSkill(identifier, profile)` IPC call, unchanged. Because that call already routes through the mode-appropriate path (local CLI / SSH / gateway — see W4-4), typing a URL there installs correctly in every connection mode without any new plumbing.
- **Local file/folder (genuinely new capability, since the CLI can't do this):** added `installSkillFromPath(sourcePath, profile)` in `src/main/skills.ts`. It validates the picked path (a folder must contain `SKILL.md`; a picked file must be named exactly `SKILL.md` — a differently-named file has no defined skill identity), reads the skill's `name` from frontmatter, slugifies it, and copies into `<profile>/skills/custom/<slug>/`. A picked single **file** copies only that file (not its containing folder) into the new directory — copying the whole folder is reserved for an explicitly-picked **folder** — specifically to avoid pulling in unrelated sibling files from wherever the user happened to browse (Downloads, Desktop, …). New `select-skill-file` (native file/folder picker) and `install-skill-from-path` IPC handlers back this; both are gated to local mode only (button hidden in the renderer via `!isRemoteMode()`, and the main-process handler independently refuses in remote/SSH mode) since `profileHome()` resolves on *this* machine — honoring the call while "connected" to a remote profile would silently write into the wrong (local) directory instead of the intended remote one.
- Success/failure surfaces via the existing `error`/toast pattern already used by the catalog Install button; the skills list refreshes via the existing `loadInstalled()` call on success — no restart needed.
- Duplicate names: `installSkillFromPath` explicitly checks whether `<profile>/skills/custom/<slug>/` already exists and returns a descriptive error ("A skill named "X" is already installed under custom. Remove it first to reinstall.") rather than silently overwriting.

## Files Changed

- `src/main/skills.ts` — `installSkillFromPath` (new).
- `src/main/ipc/register.ts` — `select-skill-file`, `install-skill-from-path` handlers (local-mode-gated).
- `src/preload/index.ts` / `index.d.ts` — `selectSkillFile`, `installSkillFromPath` bridge.
- `src/renderer/src/screens/Skills/Skills.tsx` — add-skill row (URL/identifier field + local-file button).
- `src/shared/i18n/locales/en/skills.ts` — new UI strings.
- `src/renderer/src/assets/main.css` — `.skills-add-row` styling.

## Tests

Covered by the existing full test suite (`npx vitest run`, 199 files / 1968 passing) — `Skills.test.tsx`'s existing install-button coverage continues to pass unchanged, confirming the new add-skill row didn't disturb the catalog install flow it sits alongside.

## Regression Risk

`installSkillFromPath` bypasses the CLI's own install validation/security scan entirely (the CLI has a `--force` flag implying it normally scans and can block a skill) — a locally-picked SKILL.md is copied in with no equivalent check. This is called out in `lat.md/skills.md`'s "Install from a URL, hub identifier, or local file" section as an accepted trade-off (there is no local-path equivalent of the CLI's install command to defer to), not something silently glossed over.
