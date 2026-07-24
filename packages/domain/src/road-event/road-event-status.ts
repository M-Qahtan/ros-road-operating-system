export enum RoadEventStatus {
  Detected = 'DETECTED',
  Validating = 'VALIDATING',
  Confirmed = 'CONFIRMED',
  SafetyAssessment = 'SAFETY_ASSESSMENT',
  ResponseCoordination = 'RESPONSE_COORDINATION',
  RoadClearance = 'ROAD_CLEARANCE',
  Recovery = 'RECOVERY',
  Closed = 'CLOSED',
  FalsePositive = 'FALSE_POSITIVE',
  Duplicate = 'DUPLICATE',
  UnderReview = 'UNDER_REVIEW',
  TransferredToAuthority = 'TRANSFERRED_TO_AUTHORITY'
}

export const allowedTransitions: Readonly<Record<RoadEventStatus, readonly RoadEventStatus[]>> = {
  [RoadEventStatus.Detected]: [RoadEventStatus.Validating, RoadEventStatus.FalsePositive],
  [RoadEventStatus.Validating]: [RoadEventStatus.Confirmed, RoadEventStatus.UnderReview, RoadEventStatus.FalsePositive, RoadEventStatus.Duplicate],
  [RoadEventStatus.Confirmed]: [RoadEventStatus.SafetyAssessment],
  [RoadEventStatus.SafetyAssessment]: [RoadEventStatus.ResponseCoordination],
  [RoadEventStatus.ResponseCoordination]: [RoadEventStatus.RoadClearance, RoadEventStatus.TransferredToAuthority],
  [RoadEventStatus.RoadClearance]: [RoadEventStatus.Recovery],
  [RoadEventStatus.Recovery]: [RoadEventStatus.Closed],
  [RoadEventStatus.UnderReview]: [RoadEventStatus.Validating, RoadEventStatus.Confirmed, RoadEventStatus.FalsePositive, RoadEventStatus.Duplicate],
  [RoadEventStatus.TransferredToAuthority]: [RoadEventStatus.Closed],
  [RoadEventStatus.Closed]: [],
  [RoadEventStatus.FalsePositive]: [],
  [RoadEventStatus.Duplicate]: []
};
