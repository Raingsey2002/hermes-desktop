import { getApiUrl, getApiAuthHeaders } from "./hermes";
import type { InstalledSkill, SkillCliResult } from "./skills";

// Gateway (HTTP) routing for the Skills screen — shared by remote (dashboard)
// and local mode. Skills IPC handlers used to fall through to the local CLI
// whenever an operation didn't fit a narrower mode check, so the desktop
// showed (and mutated!) the LOCAL machine's skills while connected to a
// remote dashboard — or errored outright on a machine without a local
// install. `getApiUrl`/`getApiAuthHeaders` already resolve to the right
// endpoint + auth for local, remote, and SSH, so the same client here serves
// local and remote; SSH keeps its own tunnel-exec path (sshListInstalledSkills
// et al.) since it has full local access via the tunnel already. The gateway
// exposes GET /api/skills, GET /api/skills/content, POST
// /api/skills/hub/install|uninstall (web_server.py) whether it's a remote
// dashboard or a locally-spawned gateway process.

// Marker prefix for skill "paths" that live behind the gateway API rather
// than on the local filesystem. The desktop keys skill content lookups by
// path; gateway skills are keyed by NAME + PROFILE on the API, so the path
// handed to the renderer is `gateway-skill:<profile>:<name>` and
// `gatewayGetSkillContent` unwraps both. The profile MUST ride in the path
// (mirroring how local/SSH paths carry the full location) — the content IPC
// has no profile argument, and falling back to the globally active profile
// would query the wrong profile whenever the Skills screen is scoped to a
// named one.
export const GATEWAY_SKILL_PREFIX = "gateway-skill:";

export function gatewaySkillPath(name: string, profile?: string): string {
  return `${GATEWAY_SKILL_PREFIX}${profile?.trim() || "default"}:${name}`;
}

async function skillsApi<T>(
  path: string,
  init: RequestInit = {},
  profile?: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${getApiUrl(profile)}${path}`);
  // All query params go through searchParams so encoding stays consistent —
  // mixing pre-encoded params in `path` with searchParams.set() would
  // re-serialize the former (%20 → +) only when a named profile is present.
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  // Scope to the requested profile on the unified dashboard; "default" needs
  // no param (matches dashboardApiUrl's convention in remote-sessions.ts).
  if (profile && profile !== "default") {
    url.searchParams.set("profile", profile);
  }
  const headers: Record<string, string> = {
    ...getApiAuthHeaders(profile),
    ...((init.headers as Record<string, string>) || {}),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(url.toString(), { ...init, headers });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new Error(`Gateway skills API ${response.status}: ${detail}`);
  }
  return (await response.json()) as T;
}

/**
 * List installed skills via the gateway. Throws on any failure (unreachable
 * gateway, non-2xx response, …) rather than swallowing to `[]` — callers
 * that have a better fallback (the local CLI) need to tell "gateway is
 * empty" apart from "gateway call failed"; a remote-only caller with no
 * fallback should catch and degrade itself (matching sshListInstalledSkills'
 * "unreachable → []" behavior).
 */
export async function gatewayListInstalledSkills(
  profile?: string,
): Promise<InstalledSkill[]> {
  const skills = await skillsApi<
    Array<{ name?: string; category?: string; description?: string }>
  >("/api/skills", {}, profile);
  if (!Array.isArray(skills)) return [];
  return skills
    .filter((s) => typeof s?.name === "string" && s.name)
    .map((s) => ({
      name: s.name as string,
      category: s.category || "",
      description: s.description || "",
      path: gatewaySkillPath(s.name as string, profile),
    }));
}

export async function gatewayGetSkillContent(
  skillPath: string,
  fallbackProfile?: string,
): Promise<string> {
  // Paths from gatewayListInstalledSkills embed the profile they were listed
  // under (`gateway-skill:<profile>:<name>`). A path without the separator is
  // treated as a bare name and scoped to fallbackProfile.
  let name = skillPath;
  let profile = fallbackProfile;
  if (skillPath.startsWith(GATEWAY_SKILL_PREFIX)) {
    name = skillPath.slice(GATEWAY_SKILL_PREFIX.length);
    const sep = name.indexOf(":");
    if (sep !== -1) {
      profile = name.slice(0, sep);
      name = name.slice(sep + 1);
    }
  }
  const result = await skillsApi<{ content?: string }>(
    "/api/skills/content",
    {},
    profile,
    { name },
  );
  return result.content ?? "";
}

// NB: the hub endpoints SPAWN `hermes skills install/uninstall` on the
// gateway process and return immediately ({ok, pid}) — unlike the local CLI
// path (installSkill/uninstallSkill in skills.ts), success here means
// "started", not "completed". That's the only reason local mode keeps its
// existing synchronous CLI path for install/uninstall instead of routing
// through here too: the gateway can't give local the real pass/fail
// classification (classifySkillCliOutput) it already has for free. Remote
// mode has no better option — there's no local CLI on a remote machine — so
// it accepts the async result; the renderer's list refresh picks up the
// outcome, and a resolution failure surfaces only in the remote's logs.
export async function gatewayInstallSkill(
  identifier: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/install",
      { method: "POST", body: JSON.stringify({ identifier, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Install did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function gatewayUninstallSkill(
  name: string,
  profile?: string,
): Promise<SkillCliResult> {
  try {
    const result = await skillsApi<{ ok?: boolean }>(
      "/api/skills/hub/uninstall",
      { method: "POST", body: JSON.stringify({ name, profile }) },
      profile,
    );
    return result.ok
      ? { success: true }
      : { success: false, error: "Uninstall did not start." };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
