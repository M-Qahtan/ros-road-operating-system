export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly traceId: string;
}

export interface SignalInput {
  readonly signalId: string;
  readonly sourceType: 'MANUAL_REPORT' | 'DEVICE_IMPACT' | 'OPERATOR_CREATED' | 'SIMULATION_SIGNAL';
  readonly occurredAt: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly payload: Readonly<Record<string, unknown>>;
}
