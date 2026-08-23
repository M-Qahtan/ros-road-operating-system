import { RoadEventRepository } from '@ros/domain';
import {
  EvidenceAccessAction,
  EvidenceAccessPrincipal,
  RoadEventEvidenceAuthorization
} from './evidence-types.js';

/**
 * Resource-level evidence authorization. The RoadEvent repository is the
 * authoritative tenant/purpose boundary; RoadEvents outside the principal's
 * scope are indistinguishable from missing RoadEvents.
 *
 * RBAC for upload/download actions belongs to the future Evidence HTTP/API
 * authorization layer. This adapter intentionally does not invent a new role
 * matrix that has not been approved by the ROS authorization contract.
 */
export class ScopedRoadEventEvidenceAuthorization implements RoadEventEvidenceAuthorization {
  constructor(private readonly roadEvents: RoadEventRepository) {}

  async canAccess(
    principal: EvidenceAccessPrincipal,
    roadEventId: string,
    _action: EvidenceAccessAction
  ): Promise<boolean> {
    const event = await this.roadEvents.findById(roadEventId, {
      tenantId: principal.tenantId,
      purpose: principal.purpose
    });
    return event !== undefined;
  }
}
