export interface LogContext {
  readonly traceId?: string;
  readonly roadEventId?: string;
  readonly operation?: string;
  readonly durationMs?: number;
  readonly errorCode?: string;
  readonly runtimeMode?: 'simulation' | 'persistent';
}

export function structuredLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: LogContext = {}
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: process.env.OTEL_SERVICE_NAME ?? 'ros-api',
    message,
    ...context
  });
}

export async function withTraceBoundary<T>(
  operation: string,
  traceId: string,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  console.log(structuredLog('info', 'operation.started', { operation, traceId }));
  try {
    const result = await work();
    console.log(structuredLog('info', 'operation.completed', {
      operation,
      traceId,
      durationMs: Date.now() - startedAt
    }));
    return result;
  } catch (error) {
    console.error(structuredLog('error', 'operation.failed', {
      operation,
      traceId,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : 'UnknownError'
    }));
    throw error;
  }
}
