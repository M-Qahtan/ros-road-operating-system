# ADR-004 — Sensor-Agnostic Cognitive Road State & Evidence Assurance

**Status:** Proposed for independent review  
**Date:** 2026-09-11  
**Program:** #165

## Context

ROS must consume heterogeneous road-perception capabilities without making any single hardware vendor, sensor modality, ITS platform or vehicle stack the architectural owner of road knowledge or authority.

The current system already separates RoadEvent truth from raw reports and preserves Human Safety / Authority / Purpose / Evidence boundaries. The next architecture layer extends that discipline to cameras, thermal imaging, radar, 3D/4D LiDAR, magnetic sensors, vehicles, RSUs, V2X, weather and external perception platforms.

## Decision

Adopt a canonical **Sensor & Perception Adapter boundary** followed by health/calibration validation, source lineage/provenance, CPAL/evidence assurance, Cognitive Road State, prediction/counterfactual reasoning and ROS Heart governance.

```text
Sensor / Vendor / V2X / External ITS
                |
                v
Canonical Observation Contract
                |
                v
Health + Calibration
                |
                v
Source Lineage + Provenance
                |
                v
CPAL / Evidence Assurance
                |
                v
Cognitive Road State
                |
                v
Prediction / Counterfactual Simulation
                |
                v
ROS Heart
                |
                v
Authorized Coordination
```

## Hard invariants

- `Report != RoadEvent`
- `Message Count != Evidence Count`
- `Identity != Independence`
- `Security Certificate != Truth`
- `Sensor Output != Ground Truth`
- `Knowledge != Authority`
- `Prediction != Permission`
- degradation reduces trust/knowledge; it never increases authority
- direct vehicle control is outside this ADR
- external provider recommendations never bypass ROS assurance or ROS Heart

## Data-plane decision

High-volume raw video/point-cloud/radar payloads are referenced through bounded immutable payload references. They must not be routed through the transactional RoadEvent API/database path. The application/event plane receives normalized observations, tracks, health, evidence references and state transitions.

## 4D velocity semantics

ROS explicitly separates:

- sensor-measured **radial velocity**; and
- estimated full object velocity vectors produced through tracking/estimation.

They must not share a semantic field or be represented as equivalent evidence.

## Sensor degradation

Canonical sensor state:

- `HEALTHY`
- `DEGRADED`
- `QUARANTINED`
- `UNAVAILABLE`

Canonical admission outcomes:

- `ACCEPT`
- `DEGRADED_USABLE`
- `CONTEXT_ONLY`
- `QUARANTINE`

A stale observation cannot update current cognition. Invalid calibration/provenance fails closed. A degraded but usable sensor requires corroboration rather than taking down the central pipeline.

## Saudi interoperability boundary

ROS maintains a canonical Saudi road-safety export profile, but direct NRSC/Marsad conformance remains `ICD_REQUIRED` until an authoritative interface/schema is supplied and independently mapped/tested. No inferred public fields are represented as certified government interoperability.

## Benchmark decision

Extreme-environment and 4D-perception evaluations use protected safety metrics. Lower latency, throughput or mobility gains cannot compensate for regression in human safety, missed hazards, false-hazard acceptance, unsafe confidence or authority invariants.

## Vendor posture

Aeva, FLIR, Sensys, SCAI and future platforms are modeled as replaceable capability/data providers. Vendor-specific adapters terminate at the canonical observation boundary. No provider may grant itself RoadEvent truth, operational authority, vehicle actuation or emergency authority.

## Consequences

### Positive

- vendor neutrality;
- replaceable hardware and ITS providers;
- explicit provenance and legal/audit traceability;
- graceful sensor degradation;
- clear path to multimodal/4D perception;
- safer benchmark discipline;
- compatibility with future unknown sensor technologies.

### Costs

- additional schema/version governance;
- coordinate/time synchronization complexity;
- adapter certification burden;
- evidence-storage and telemetry volume;
- more explicit uncertainty/abstention states.

## Promotion gate

This ADR is not production/public-road approval. Promotion requires:

`Requirement -> Hazard -> Code -> Test -> Evidence -> Independent Review -> Gate`
