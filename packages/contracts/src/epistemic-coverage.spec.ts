import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EPISTEMIC_COVERAGE_ASSERTION_SCHEMA,
  validateEpistemicCoverageAssertion,
  validateEpistemicCoverageRegion,
  type EpistemicCoverageAssertion,
  type EpistemicCoverageRegion,
} from './epistemic-coverage.js';

const digest = 'a'.repeat(64);

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

test('valid coverage region and assertion pass structural validation', () => {
  assert.deepEqual(validateEpistemicCoverageRegion(region()), []);
  assert.deepEqual(validateEpistemicCoverageAssertion(assertion()), []);
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

test('region geometry must be bound to a SHA-256 digest', () => {
  const value = { ...region(), geometryDigest: 'not-a-digest' } as EpistemicCoverageRegion;
  assert(validateEpistemicCoverageRegion(value).includes('INVALID_GEOMETRY_DIGEST'));
});
