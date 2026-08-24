import {
  RealDeviceEvidenceBundle,
  RealDeviceEvidenceDecision,
  VerifiedRealDeviceEvidenceFiles,
  evaluateRealDeviceEvidence,
  parseRealDeviceEvidenceBundle
} from './real-device-evidence.js';

const REQUIRED_CRITICAL_FLOW_LANGUAGES = ['ar', 'en', 'ur'] as const;
export type RequiredFieldLanguage = (typeof REQUIRED_CRITICAL_FLOW_LANGUAGES)[number];

export interface RequiredLocaleCoverageDecision {
  readonly requiredLocaleCriticalFlowsPassed: boolean;
  readonly passedRequiredLocales: readonly RequiredFieldLanguage[];
  readonly missingRequiredLocales: readonly RequiredFieldLanguage[];
}

export interface ControlledFieldLabEvidenceDecision extends RealDeviceEvidenceDecision, RequiredLocaleCoverageDecision {}

function localeLanguage(locale: string): string {
  const language = locale.split(/[-_]/, 1)[0]?.toLowerCase();
  return language ?? '';
}

function criticalFlowPassed(session: RealDeviceEvidenceBundle['sessions'][number]): boolean {
  return session.scenarios.some((scenario) =>
    scenario.kind === 'CRITICAL_FLOW' &&
    scenario.outcome === 'PASS' &&
    scenario.privacyDataMinimized &&
    scenario.duplicateLogicalActionsObserved === 0 &&
    scenario.staleUnsafeActionsObserved === 0
  );
}

export function evaluateRequiredLocaleCoverage(bundle: RealDeviceEvidenceBundle): RequiredLocaleCoverageDecision {
  const passed = new Set<RequiredFieldLanguage>();
  for (const session of bundle.sessions) {
    const language = localeLanguage(session.device.locale);
    if ((REQUIRED_CRITICAL_FLOW_LANGUAGES as readonly string[]).includes(language) && criticalFlowPassed(session)) {
      passed.add(language as RequiredFieldLanguage);
    }
  }
  const passedRequiredLocales = REQUIRED_CRITICAL_FLOW_LANGUAGES.filter((language) => passed.has(language));
  const missingRequiredLocales = REQUIRED_CRITICAL_FLOW_LANGUAGES.filter((language) => !passed.has(language));
  return Object.freeze({
    requiredLocaleCriticalFlowsPassed: missingRequiredLocales.length === 0,
    passedRequiredLocales: Object.freeze(passedRequiredLocales),
    missingRequiredLocales: Object.freeze(missingRequiredLocales)
  });
}

/**
 * Final controlled-field-lab gate layered over byte-verified real-device evidence.
 * It adds required Arabic, English and Urdu critical-flow coverage without weakening
 * the existing Android/iOS, GPS, network, restart, accessibility, integrity or exact-head gates.
 */
export function evaluateControlledFieldLabEvidence(
  value: unknown,
  verifiedEvidence?: VerifiedRealDeviceEvidenceFiles
): ControlledFieldLabEvidenceDecision {
  const bundle = parseRealDeviceEvidenceBundle(value);
  const base = evaluateRealDeviceEvidence(bundle, verifiedEvidence);
  const localeCoverage = evaluateRequiredLocaleCoverage(bundle);
  const missingCoverage = [
    ...base.missingCoverage,
    ...(localeCoverage.requiredLocaleCriticalFlowsPassed ? [] : ['Arabic+English+Urdu critical-flow coverage'])
  ];
  return Object.freeze({
    ...base,
    status: base.status === 'PASS' && localeCoverage.requiredLocaleCriticalFlowsPassed ? 'PASS' as const : 'NO_GO' as const,
    missingCoverage: Object.freeze(missingCoverage),
    ...localeCoverage
  });
}
