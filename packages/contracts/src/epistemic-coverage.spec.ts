import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
  EPISTEMIC_COVERAGE_CONTRADICTION_SCHEMA,
  validateEpistemicCoverageAssertion,
  validateEpistemicCoverageContradiction,
  validateEpistemicCoverageRegion,
  type EpistemicCoverageAssertion,
  type EpistemicCoverageContradiction,
  type EpistemicCoverageRegion,
} from './epistemic-coverage.js';

const digest = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function region(): EpistemicCoverageRegion {
  return {
    regionId: 'crosswalk-41',
    zoneId: 'RUH-Z41',
    regionType: 'CROSSWALK',
    spatialFrameId: 'map-ruh-z41',
    geometryDigest: digest,
  };
}

function assertion(): EpistemicCoverageAssertion {
  return {
    schema: EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
    assertionId: 'assertion-1',
    regionId: 'crosswalk-41',
    dimension: 'VULNERABLE_ROAD_USERS',
    observationId: 'obs-1',
    state: 'COVERED',
    confidence: 0.95,
    occlusionFraction: 0.05,
    degradationCauses: [],
    reasonCodes: [],
    validUntil: '2026-09-12T06:00:06+03:00',
    authority: 'NONE',
  };
}

function contradiction(): EpistemicCoverageContradiction {
  return {
    schema: EPISTEMIC_COVERAGE_CONTRADICTION_SCHEMA,
    contradictionId: 'contradiction-1',
    regionId: 'crosswalk-41',
    dimension: 'VULNERABLE_ROAD_USERS',
    observationIds: ['obs-1', 'obs-2'],
    independenceClassDigests: [digest, digestB],
    reason: 'GEOMETRIC_COVERAGE_EVIDENCE_CONFLICT',
    validUntil: '2026-09-12T06:00:06+03:00',
    material: true,
    authority: 'NONE',
  };
}

test('valid coverage region, assertion and contradiction pass structural validation', () => {
  assert.deepEqual(validateEpistemicCoverageRegion(region()), []);
  assert.deepEqual(validateEpistemicCoverageAssertion(assertion()), []);
  assert.deepEqual(validateEpistemicCoverageContradiction(contradiction()), []);
});

test('coverage assertion cannot import authority through runtime casting', () => {
  const value = { ...assertion(), authority: 'COMMAND' } as unknown as EpistemicCoverageAssertion;
  assert(validateEpistemicCoverageAssertion(value).includes('COVERAGE_AUTHORITY_FORBIDDEN'));
});

test('invalid occlusion fractions fail closed', () => {
  const value = { ...assertion(), occlusionFraction: 1.5 } as EpistemicCoverageAssertion;
  assert(validateEpistemicCoverageAssertion(value).includes('INVALID_OCCLUSION_FRACTION'));
});

test('spoofed coverage dimension fails runtime validation', () => {
  const value = { ...assertion(), dimension: 'OMNISCIENCE' } as unknown as EpistemicCoverageAssertion;
  assert(validateEpistemicCoverageAssertion(value).includes('INVALID_COVERAGE_DIMENSION'));
});

test('spoofed degradation cause fails runtime validation', () => {
  const value = { ...assertion(), degradationCauses: ['MAGIC_VISIBILITY_LOSS'] } as unknown as EpistemicCoverageAssertion;
  assert(validateEpistemicCoverageAssertion(value).includes('INVALID_DEGRADATION_CAUSES'));
});

test('region geometry must be bound to a SHA-256 digest', () => {
  const value = { ...region(), geometryDigest: 'not-a-digest' } as EpistemicCoverageRegion;
  assert(validateEpistemicCoverageRegion(value).includes('INVALID_GEOMETRY_DIGEST'));
});

test('material contradiction requires at least two distinct independence classes', () => {
  const value = {
    ...contradiction(),
    independenceClassDigests: [digest, digest],
  } as EpistemicCoverageContradiction;
  const errors = validateEpistemicCoverageContradiction(value);
  assert(errors.includes('DUPLICATE_CONTRADICTION_INDEPENDENCE_CLASS'));
});

test('coverage contradiction cannot import authority', () => {
  const value = { ...contradiction(), authority: 'COMMAND' } as unknown as EpistemicCoverageContradiction;
  assert(validateEpistemicCoverageContradiction(value).includes('COVERAGE_AUTHORITY_FORBIDDEN'));
});
