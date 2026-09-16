import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PROVIDERS,
  displayBrandFromConfig,
  envKeyForSavedModel,
  OAUTH_ONLY_PROVIDER_IDS,
} from "../../../constants";
import { useDiscoveredModels } from "../../../hooks/useDiscoveredModels";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

/**
 * Named providers (deepseek, groq, anthropic, …) have a hardcoded canonical
 * base_url in hermes-agent's PROVIDER_REGISTRY, so a stored `baseUrl` on those
 * entries can be stale and would misroute the request. Keep the baseUrl only
 * for `custom` and `ollama-cloud` entries, where it is authoritative; clear it
 * otherwise so the backend falls back to the provider's canonical URL. Shared
 * by `selectModel` and the chat-screen session override so they can't drift.
 */
export function effectiveOverrideBaseUrl(
  provider: string,
  baseUrl: string,
): string {
  return provider === "custom" || provider === OLLAMA_CLOUD_PROVIDER
    ? baseUrl
    : "";
}

interface SavedModelForPicker {
  provider: string;
  model: string;
  name: string;
  baseUrl?: string;
  providerLabel?: string;
}

/**
 * The chat-input picker should only offer models a message could actually be
 * sent to. `listModels()` returns the whole saved library regardless of
 * whether a key is configured (it's also the source for the Providers-tab
 * model editor, which needs the unfiltered set), so filter here for models
 * whose provider has no resolvable key and no authenticated OAuth session —
 * picking one would only fail at send time with no indication why.
 */
function isProviderConfigured(
  m: SavedModelForPicker,
  env: Record<string, string>,
  oauthStatuses: Record<string, boolean>,
): boolean {
  if (OAUTH_ONLY_PROVIDER_IDS.has(m.provider) && oauthStatuses[m.provider]) {
    return true;
  }
  const envKey = envKeyForSavedModel(
    m.provider,
    m.baseUrl || "",
    m.providerLabel,
  );
  // Unrecognized provider id: no table maps it to a known key, so we can't
  // prove it's unconfigured — keep it visible rather than risk hiding a
  // legitimately usable model.
  if (!envKey) return true;
  return !!(env[envKey] && env[envKey].trim());
}

function mergeLiveOllamaCloudModels(
  savedModels: SavedModelForPicker[],
  liveModels: string[],
  liveStatus: string,
): SavedModelForPicker[] {
  if (liveStatus !== "ok" || liveModels.length === 0) {
    return savedModels;
  }

  const liveEntries = Array.from(new Set(liveModels))
    .sort()
    .map((model) => ({
      provider: OLLAMA_CLOUD_PROVIDER,
      model,
      name: `Ollama Cloud · ${model}`,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
    }));

  return [
    ...savedModels.filter((model) => model.provider !== OLLAMA_CLOUD_PROVIDER),
    ...liveEntries,
  ];
}

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    options?: { persist?: boolean },
  ) => Promise<void>;
}

function groupModelsByProvider(models: SavedModelForPicker[]): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    // Group by display brand so OpenAI-compatible providers stored as `custom`
    // (Hermes One, Groq, …) show under their own header instead of the generic
    // "OpenAI Compatible / Local" bucket. Each model keeps its raw provider +
    // baseUrl below so selection/routing is unchanged.
    const brand = displayBrandFromConfig(m.provider, m.baseUrl || "");
    if (!groupMap.has(brand)) {
      groupMap.set(brand, {
        provider: brand,
        providerLabel: PROVIDERS.labels[brand] || brand,
        models: [],
      });
    }
    groupMap.get(brand)!.models.push({
      provider: m.provider,
      model: m.model,
      label: m.name,
      baseUrl: m.baseUrl || "",
    });
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelForPicker[]>([]);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [oauthStatuses, setOauthStatuses] = useState<Record<string, boolean>>(
    {},
  );
  const loadSeqRef = useRef(0);

  const ollamaCloudDiscovery = useDiscoveredModels({
    provider: OLLAMA_CLOUD_PROVIDER,
    profile,
    enabled: true,
  });

  // `.filter` always returns a new array, so without this, a caller whose
  // `ollamaCloudDiscovery.models`/`env`/`oauthStatuses` references churn every
  // render (they aren't guaranteed stable — only their *content* is, once
  // discovery/env settle) would hand the effect below a "changed" array on
  // every render, which re-sets `modelGroups`, which re-renders, forever.
  // Keep the previous array reference whenever the filtered *content* is
  // unchanged so that loop can't start.
  const modelsForPickerRef = useRef<SavedModelForPicker[]>([]);
  const modelsForPicker = useMemo(() => {
    const filtered = mergeLiveOllamaCloudModels(
      savedModels,
      ollamaCloudDiscovery.models,
      ollamaCloudDiscovery.status,
    ).filter((m) => isProviderConfigured(m, env, oauthStatuses));
    const prev = modelsForPickerRef.current;
    const unchanged =
      prev.length === filtered.length &&
      prev.every(
        (m, i) =>
          m.provider === filtered[i].provider &&
          m.model === filtered[i].model &&
          m.name === filtered[i].name &&
          m.baseUrl === filtered[i].baseUrl,
      );
    if (!unchanged) modelsForPickerRef.current = filtered;
    return unchanged ? prev : filtered;
  }, [
    savedModels,
    ollamaCloudDiscovery.models,
    ollamaCloudDiscovery.status,
    env,
    oauthStatuses,
  ]);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current;
    const [mc, savedModels, env, oauthStatuses] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
      // Best-effort: a failure here should degrade to "can't confirm any
      // provider is configured" (all models filtered out) rather than break
      // model loading entirely.
      window.hermesAPI.getEnv(profile).catch(() => ({})),
      window.hermesAPI.getOAuthProviderStatuses(profile).catch(() => ({})),
    ]);
    if (seq !== loadSeqRef.current) return;
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    setSavedModels(savedModels);
    setEnv(env);
    setOauthStatuses(oauthStatuses);
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    setModelGroups(groupModelsByProvider(modelsForPicker));
  }, [modelsForPicker]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModelGroups([]);
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      { persist = true }: { persist?: boolean } = {},
    ): Promise<void> => {
      const effectiveBaseUrl = effectiveOverrideBaseUrl(provider, baseUrl);
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
      // Session-only selection: update local state only, do not write to
      // config.yaml so the global default model is preserved (issue #688).
      // Advance the sequence counter so any in-flight reload() triggered by
      // onConnectionConfigChanged / onModelLibraryChanged cannot clobber the
      // session-scoped selection with the persisted value.
      if (!persist) {
        ++loadSeqRef.current;
        return;
      }
      const seq = ++loadSeqRef.current;
      try {
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          effectiveBaseUrl,
          profile,
        );
        const mc = await window.hermesAPI.getModelConfig(profile);
        if (seq !== loadSeqRef.current) return;
        setCurrentModel(mc.model);
        setCurrentProvider(mc.provider);
        setCurrentBaseUrl(mc.baseUrl);
      } catch (err) {
        if (seq === loadSeqRef.current) await reload();
        throw err;
      }
    },
    [profile, reload],
  );

  const displayModel = useMemo(
    () =>
      currentModel
        ? currentModel.split("/").pop() || currentModel
        : currentProvider === "auto"
          ? t("chat.auto")
          : t("chat.noModel"),
    [currentModel, currentProvider, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
