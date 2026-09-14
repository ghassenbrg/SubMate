/** Sends a message to the background worker and unwraps its `{ ok, value }` envelope. */
export async function requestWorker<T>(message: Record<string, unknown>): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? `${String(message.type)} failed`);
  return response.value as T;
}
