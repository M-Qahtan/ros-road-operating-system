import assert from 'node:assert/strict';
import test from 'node:test';
import { createActorResolverForEnvironment } from './actor-resolver.js';

test('development may resolve deterministic simulation headers', () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'development' });
  assert.deepEqual(
    resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR,SUPERVISOR' }),
    { actorId: 'operator-1', roles: ['OPERATOR', 'SUPERVISOR'] }
  );
});

test('staging requires explicit simulation auth profile for header identity', () => {
  const denied = createActorResolverForEnvironment({ NODE_ENV: 'staging' });
  assert.throws(
    () => denied.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR' }),
    /Trusted OIDC\/JWT actor resolver is required/
  );

  const simulation = createActorResolverForEnvironment({
    NODE_ENV: 'staging',
    ROS_AUTH_PROFILE: 'simulation'
  });
  assert.equal(
    simulation.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'OPERATOR' }).actorId,
    'operator-1'
  );
});

test('production rejects self-attested actor headers even when simulation is requested', () => {
  const resolver = createActorResolverForEnvironment({
    NODE_ENV: 'production',
    ROS_AUTH_PROFILE: 'simulation'
  });
  assert.throws(
    () => resolver.resolve({ 'x-actor-id': 'attacker', 'x-ros-roles': 'SUPERVISOR' }),
    /self-attested actor headers are disabled/
  );
});

test('simulation header resolver rejects missing or unknown roles', () => {
  const resolver = createActorResolverForEnvironment({ NODE_ENV: 'test' });
  assert.throws(() => resolver.resolve({ 'x-actor-id': 'operator-1' }), /Missing actor identity headers/);
  assert.throws(
    () => resolver.resolve({ 'x-actor-id': 'operator-1', 'x-ros-roles': 'ROOT' }),
    /No recognized ROS role/
  );
});
