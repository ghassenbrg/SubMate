import { loadCloudApiKey } from './credentials';
import { originPattern, resolveEndpoint, type CloudEndpoint } from './providers';

/** What still stands between the user's configuration and a working request. */
export type CloudSetupIssue = 'endpoint' | 'key' | 'permission';

export interface CloudSettings {
  cloudVendor: string;
  cloudModel: string;
  cloudBaseUrl: string;
}

export const hasHostPermission = async (baseUrl: string): Promise<boolean> => {
  try {
    return await chrome.permissions.contains({ origins: [originPattern(baseUrl)] });
  } catch {
    return false;
  }
};

export async function cloudSetup(
  settings: CloudSettings,
): Promise<{ issue?: CloudSetupIssue; endpoint?: CloudEndpoint; apiKey: string }> {
  const endpoint = resolveEndpoint(settings);
  if (!endpoint) return { issue: 'endpoint', apiKey: '' };
  const apiKey = await loadCloudApiKey(endpoint.provider.id);
  if (endpoint.provider.keyRequired && !apiKey) return { issue: 'key', endpoint, apiKey };
  // Hosts are optional permissions granted per provider from the options page.
  if (!(await hasHostPermission(endpoint.baseUrl))) return { issue: 'permission', endpoint, apiKey };
  return { endpoint, apiKey };
}
