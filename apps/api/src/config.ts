export function parsePort(rawPort: string | undefined): number {
  const value = rawPort?.trim() ?? '3000';
  if (!/^\d{1,5}$/.test(value)) {
    throw new TypeError('PORT must be an integer between 1 and 65535');
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError('PORT must be an integer between 1 and 65535');
  }
  return port;
}
