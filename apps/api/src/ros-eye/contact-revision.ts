import { createHash } from 'node:crypto';
import type { ContactSessionRecord } from './contact-orchestration.js';

export interface ContactRevisionScope {
  readonly tenantId: string;
  readonly purpose: string;
  readonly caseId: string;
}

export function contactRevisionDigest(
  scope: ContactRevisionScope,
  sessions: readonly ContactSessionRecord[]
): string {
  const material = {
    policyVersion: 'ros-eye.contact-revision.v1',
    tenantId: scope.tenantId,
    purpose: scope.purpose,
    caseId: scope.caseId,
    sessions: [...sessions]
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
      .map((session) => ({
        sessionId: session.sessionId,
        ownerActorId: session.ownerActorId,
        state: session.state,
        version: session.version,
        protocolVersion: session.protocolVersion,
        promptPolicyVersion: session.promptPolicyVersion,
        accessibilityPolicyVersion: session.accessibilityPolicyVersion,
        language: session.language,
        identityConfidence: session.identityConfidence,
        activeChannel: session.activeChannel,
        attemptCount: session.attemptCount,
        responseDeadlineAt: session.responseDeadlineAt,
        nextActionAt: session.nextActionAt,
        lastInteractionAt: session.lastInteractionAt,
        assignedOperatorId: session.assignedOperatorId,
        accessibility: session.accessibility,
        automationSuppressed: session.automationSuppressed,
        updatedAt: session.updatedAt
      }))
  };
  return createHash('sha256').update(canonicalize(material), 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(source[key])}`).join(',')}}`;
}
