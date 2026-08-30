import type { HumanSafetyActorRole, RosRoleContract } from '@ros/contracts';

export type BrowserOperatorRole = Extract<
  HumanSafetyActorRole | RosRoleContract,
  'OPERATOR' | 'SUPERVISOR' | 'SAFETY_LEAD' | 'AUDITOR'
>;

export interface OperationsAccessTokenProvider {
  readonly tenantId: string;
  readonly purpose: string;
  getAccessToken(): Promise<string>;
}

export interface TrustedBrowserSession extends OperationsAccessTokenProvider {
  readonly actorId: string;
  readonly roles: readonly BrowserOperatorRole[];
}

export interface OperationsWindow extends Window {
  readonly rosOidcSession?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const BROWSER_ROLES = new Set<BrowserOperatorRole>(['OPERATOR', 'SUPERVISOR', 'SAFETY_LEAD', 'AUDITOR']);

/**
 * Accepts only the session installed by the hosting OIDC bridge. The dashboard
 * never derives authority from DOM data attributes, local storage, or token
 * claims decoded in the browser.
 */
export function requireTrustedBrowserSession(target: OperationsWindow): TrustedBrowserSession {
  const candidate = target.rosOidcSession;
  if (!isRecord(candidate) || typeof candidate.getAccessToken !== 'function') {
    throw new Error('لم تُنشأ جلسة OIDC موثوقة للوحة العمليات');
  }
  if (typeof candidate.actorId !== 'string' || !UUID_PATTERN.test(candidate.actorId)) {
    throw new Error('هوية جلسة لوحة العمليات غير صالحة');
  }
  if (!Array.isArray(candidate.roles) || candidate.roles.length === 0
    || candidate.roles.some((role) => typeof role !== 'string' || !BROWSER_ROLES.has(role as BrowserOperatorRole))) {
    throw new Error('أدوار جلسة لوحة العمليات غير صالحة');
  }
  if (typeof candidate.tenantId !== 'string' || typeof candidate.purpose !== 'string'
    || !SCOPE_PATTERN.test(candidate.tenantId) || !SCOPE_PATTERN.test(candidate.purpose)) {
    throw new Error('نطاق جلسة لوحة العمليات غير صالح');
  }
  return candidate as unknown as TrustedBrowserSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
