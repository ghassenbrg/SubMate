export function parseTimeExpression(
  raw: string | null,
  options: { frameRate?: number; tickRate?: number } = {},
): number | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    // Netflix DFXP commonly encodes 10,000,000 ticks per second.
    const number = Number(value);
    return Math.round((number / (options.tickRate ?? 10_000_000)) * 1000);
  }
  const clock = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?(?::(\d{1,3}))?$/.exec(value);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    const fraction = clock[4] ? Number(`0.${clock[4]}`) : 0;
    const frames = clock[5] ? Number(clock[5]) / (options.frameRate ?? 30) : 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds + fraction + frames) * 1000);
  }
  const offset = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(value);
  if (!offset) return undefined;
  const number = Number(offset[1]);
  switch (offset[2]) {
    case 'h': return Math.round(number * 3_600_000);
    case 'm': return Math.round(number * 60_000);
    case 's': return Math.round(number * 1000);
    case 'ms': return Math.round(number);
    case 'f': return Math.round((number / (options.frameRate ?? 30)) * 1000);
    case 't': return Math.round((number / (options.tickRate ?? 10_000_000)) * 1000);
  }
}

export function parseWebVttTime(raw: string): number | undefined {
  const parts = raw.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) return undefined;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

export const formatSrtTime = (ms: number): string => {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
};

export const formatVttTime = (ms: number): string => formatSrtTime(ms).replace(',', '.');
