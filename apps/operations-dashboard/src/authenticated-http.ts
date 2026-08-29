import type { ApiEnvelope } from '@ros/contracts';
import type { OperationsAccessTokenProvider } from './trusted-browser-session.js';

export interface AuthenticatedRequestFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly traceId: string;
  readonly outcomeAmbiguous: boolean;
}

interface AuthenticatedRequestOptions<TError extends Error> {
  readonly baseUrl: string;
  readonly path: string;
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly session: OperationsAccessTokenProvider;
  readonly fetcher: typeof fetch;
  readonly createError: (failure: AuthenticatedRequestFailure) => TError;
}

const TOKEN_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,16384}$/;
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TRACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

export async function authenticatedApiRequest<T, TError extends Error>(
  options: AuthenticatedRequestOptions<TError>
): Promise<T> {
  const method = options.method ?? 'GET';
  const target = apiTarget(options.baseUrl, options.path, options.createError);
  const token = await accessToken(options.session, options.createError);
  const scope = accessScope(options.session, options.createError);
  let response: Response;
  try {
    response = await options.fetcher(target, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-tenant-id': scope.tenantId,
        'x-purpose': scope.purpose,
        ...(options.idempotencyKey === undefined ? {} : { 'idempotency-key': options.idempotencyKey })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
  } catch {
    throw options.createError(networkFailure(method));
  }

  const envelope = await readEnvelope<T>(response);
  if (response.ok && envelope !== null && envelope.success && envelope.data !== null) return envelope.data;
  throw options.createError(httpFailure(response.status, method, safeTraceId(envelope?.traceId)));
}

function apiTarget<TError extends Error>(
  baseUrl: string,
  path: string,
  createError: (failure: AuthenticatedRequestFailure) => TError
): string {
  if (!path.startsWith('/')) throw createError(configurationFailure());
  const normalizedBase = baseUrl.trim().replace(/\/$/, '');
  if (normalizedBase.length === 0) return path;
  let parsed: URL;
  try { parsed = new URL(normalizedBase); }
  catch { throw createError(configurationFailure()); }
  const localHttp = parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if ((parsed.protocol !== 'https:' && !localHttp) || parsed.username !== '' || parsed.password !== ''
    || parsed.search !== '' || parsed.hash !== '') {
    throw createError(configurationFailure());
  }
  return `${normalizedBase}${path}`;
}

async function accessToken<TError extends Error>(
  session: OperationsAccessTokenProvider,
  createError: (failure: AuthenticatedRequestFailure) => TError
): Promise<string> {
  let token: string;
  try { token = (await session.getAccessToken()).trim(); }
  catch { throw createError(authenticationFailure()); }
  if (!TOKEN_PATTERN.test(token)) throw createError(authenticationFailure());
  return token;
}

function accessScope<TError extends Error>(
  session: OperationsAccessTokenProvider,
  createError: (failure: AuthenticatedRequestFailure) => TError
): { readonly tenantId: string; readonly purpose: string } {
  if (!SCOPE_PATTERN.test(session.tenantId) || !SCOPE_PATTERN.test(session.purpose)) {
    throw createError(configurationFailure());
  }
  return { tenantId: session.tenantId, purpose: session.purpose };
}

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  try {
    const value: unknown = await response.json();
    if (!isRecord(value) || typeof value.success !== 'boolean') return null;
    return value as unknown as ApiEnvelope<T>;
  } catch { return null; }
}

function authenticationFailure(): AuthenticatedRequestFailure {
  return {
    status: 401,
    code: 'AUTHENTICATION_REQUIRED',
    message: 'لا توجد جلسة دخول موثوقة. أعد تسجيل الدخول قبل المتابعة.',
    traceId: 'local-session',
    outcomeAmbiguous: false
  };
}

function configurationFailure(): AuthenticatedRequestFailure {
  return {
    status: 0,
    code: 'UNSAFE_CLIENT_CONFIGURATION',
    message: 'تعذر بدء إعداد اتصال آمن مع خدمة ROS.',
    traceId: 'local-configuration',
    outcomeAmbiguous: false
  };
}

function networkFailure(method: 'GET' | 'POST'): AuthenticatedRequestFailure {
  return {
    status: 0,
    code: 'NETWORK_UNAVAILABLE',
    message: method === 'POST'
      ? 'تعذر التحقق من نتيجة الإجراء. حدّث البيانات قبل المحاولة مجددًا.'
      : 'تعذر الاتصال بخدمة ROS. أعد المحاولة بعد التحقق من الاتصال.',
    traceId: 'local-network',
    outcomeAmbiguous: method === 'POST'
  };
}

function httpFailure(status: number, method: 'GET' | 'POST', traceId: string): AuthenticatedRequestFailure {
  if (status === 401) return { status, code: 'AUTHENTICATION_REQUIRED', message: 'انتهت جلسة الدخول أو لم تعد صالحة. أعد تسجيل الدخول.', traceId, outcomeAmbiguous: false };
  if (status === 403) return { status, code: 'FORBIDDEN', message: 'لا تملك صلاحية الوصول إلى هذا النطاق أو تنفيذ هذا الإجراء.', traceId, outcomeAmbiguous: false };
  if (status === 404) return { status, code: 'NOT_FOUND', message: 'لم يعد السجل المطلوب متاحًا. حدّث البيانات.', traceId, outcomeAmbiguous: false };
  if (status === 409) return { status, code: 'CONFLICT', message: 'تغيرت البيانات منذ آخر تحديث. حدّث الشاشة قبل اتخاذ قرار جديد.', traceId, outcomeAmbiguous: method === 'POST' };
  if (status >= 500) return {
    status,
    code: 'SERVICE_UNAVAILABLE',
    message: method === 'POST'
      ? 'الخدمة غير متاحة ولم يتم تأكيد نتيجة الإجراء. حدّث البيانات قبل المحاولة مجددًا.'
      : 'خدمة ROS غير متاحة مؤقتًا. أعد المحاولة لاحقًا.',
    traceId,
    outcomeAmbiguous: method === 'POST'
  };
  return { status, code: 'REQUEST_REJECTED', message: 'تعذر قبول الطلب. راجع البيانات وحدّث الشاشة.', traceId, outcomeAmbiguous: false };
}

function safeTraceId(value: unknown): string {
  return typeof value === 'string' && TRACE_PATTERN.test(value) ? value : 'remote-unavailable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
