/**
 * Cloud translation providers.
 *
 * Every provider is reached through the OpenAI-compatible Chat Completions
 * protocol, so a provider is data rather than code: an endpoint, a default
 * model and the few request quirks that differ between them. `custom` covers
 * anything else that speaks the protocol — Ollama, LM Studio, vLLM, LiteLLM, a
 * company gateway.
 */
export interface CloudProvider {
  readonly id: string;
  readonly label: string;
  /** Absent only for `custom`, where the user supplies it. */
  readonly baseUrl?: string;
  /** Absent only for `custom`, where the model must be named. */
  readonly defaultModel?: string;
  /** Local servers usually run without a key. */
  readonly keyRequired: boolean;
  /** Sends `response_format: json_object`. Off where it is rejected or ignored. */
  readonly jsonMode: boolean;
  /** Recognizes this provider's keys, so pasting a key can pick the provider. */
  readonly keyPattern?: RegExp;
  /** Where to create a key. */
  readonly keyUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly extraBody?: Readonly<Record<string, unknown>>;
}

export const CUSTOM_PROVIDER_ID = 'custom';

export const CLOUD_PROVIDERS: readonly CloudProvider[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    // gemini-2.0-flash was shut down on 2026-06-01; pinned stable models rot
    // too, so the options page also offers the live model list.
    defaultModel: 'gemini-3.5-flash-lite',
    keyRequired: true,
    jsonMode: true,
    keyPattern: /^AIza[\w-]{20,}$/,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    label: 'OpenAI (ChatGPT)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.6-luna',
    keyRequired: true,
    jsonMode: true,
    keyPattern: /^sk-(?:proj|svcacct|admin)-[\w-]{20,}$/,
    keyUrl: 'https://platform.openai.com/api-keys',
    // Subtitles need fidelity, not deliberation; medium effort only adds latency.
    extraBody: { reasoning_effort: 'low' },
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-haiku-4-5',
    keyRequired: true,
    // The compatibility layer ignores response_format; the prompt carries it.
    jsonMode: false,
    keyPattern: /^sk-ant-[\w-]{20,}$/,
    keyUrl: 'https://platform.claude.com/settings/keys',
    // Requests from an extension carry an Origin header, which the API refuses
    // without this opt-in. The key never reaches a web page either way.
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    keyRequired: true,
    jsonMode: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-flash',
    keyRequired: true,
    jsonMode: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.6',
    keyRequired: true,
    jsonMode: true,
    keyPattern: /^xai-[\w-]{20,}$/,
    keyUrl: 'https://console.x.ai',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-20b',
    keyRequired: true,
    jsonMode: true,
    keyPattern: /^gsk_\w{20,}$/,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    keyRequired: true,
    jsonMode: true,
    keyPattern: /^sk-or-[\w-]{20,}$/,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: CUSTOM_PROVIDER_ID,
    label: 'Custom',
    keyRequired: false,
    // Local servers disagree on JSON mode; some reject the field outright.
    jsonMode: false,
  },
];

const BY_ID = new Map(CLOUD_PROVIDERS.map((provider) => [provider.id, provider]));

export const DEFAULT_CLOUD_PROVIDER = 'gemini';

export const isCloudProviderId = (id: unknown): id is string => typeof id === 'string' && BY_ID.has(id);

export const cloudProvider = (id: string): CloudProvider =>
  BY_ID.get(id) ?? (BY_ID.get(DEFAULT_CLOUD_PROVIDER) as CloudProvider);

/** The provider a pasted key unambiguously belongs to, if any. */
export const detectProviderFromKey = (key: string): CloudProvider | undefined => {
  const trimmed = key.trim();
  return CLOUD_PROVIDERS.find((provider) => provider.keyPattern?.test(trimmed));
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validates a user-supplied base URL. HTTPS is required so a key is never sent
 * in the clear; plain HTTP is allowed only for a server on this machine.
 * Returns the URL without a trailing slash, or undefined if unusable.
 */
export function normalizeBaseUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const secure = url.protocol === 'https:';
  const loopback = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !loopback) return undefined;
  if (url.username || url.password || url.search || url.hash) return undefined;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

export interface CloudEndpoint {
  provider: CloudProvider;
  baseUrl: string;
  model: string;
}

/**
 * Where requests for the selected provider go, or undefined if the
 * configuration is incomplete. Presets always use their own endpoint, so a
 * stale custom URL can never redirect a preset's key elsewhere.
 */
export function resolveEndpoint(settings: {
  cloudVendor: string;
  cloudModel: string;
  cloudBaseUrl: string;
}): CloudEndpoint | undefined {
  const provider = cloudProvider(settings.cloudVendor);
  const baseUrl = provider.baseUrl ?? normalizeBaseUrl(settings.cloudBaseUrl);
  const model = settings.cloudModel || provider.defaultModel;
  if (!baseUrl || !model) return undefined;
  return { provider, baseUrl, model };
}

/**
 * The host permission covering an endpoint. Match patterns cannot carry a
 * port, so a grant for localhost covers every local server — which is what
 * someone running Ollama and LM Studio side by side wants anyway.
 */
export const originPattern = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.hostname}/*`;
};
