# ADR-003: Provider-Neutral Map and Routing Boundary

**Status:** Proposed for RC1 post-merge validation

## Context

ROS needs basemap, geocoding, road matching, routing and traffic inputs for the Riyadh MVP, but an external map vendor must not become authoritative for RoadEvent state, hazard severity, closures, evidence, or S3/S4 decisions. Vendor lock-in would also make later government GIS, HERE, TomTom or Mapbox integration unnecessarily expensive.

## Decision

ROS owns authoritative geo and safety state in its domain and PostgreSQL/PostGIS. External map services are accessed only through a provider-neutral `MapProviderPort` and produce short-lived **advisory** route snapshots.

The first controlled provider implementation is Google Maps Platform Routes API. The adapter:

- sends only origin/destination coordinates plus an explicit routing preference;
- requests only route duration, distance and encoded polyline through a narrow field mask;
- never sends RoadEvent IDs, evidence payloads, medical/legal content, tenant/purpose, actor identity or contact data;
- obtains credentials through an injected secret provider and never stores them in source control;
- uses a fixed HTTPS endpoint, rejects redirects, bounds timeout/response size and treats malformed/stale/provider-failed output as `DEGRADED`;
- cannot mutate RoadEvent or grant S3/S4 authority.

Google is a replaceable adapter. Other providers must implement the same boundary and pass the same privacy, freshness and failure-mode tests before use.

## Safety boundary

A map-provider response is never sufficient evidence for emergency dispatch, severity downgrade, road closure/reopening, vehicle actuation or any other safety-critical action. When routing data is unavailable, stale or invalid, ROS exposes degraded routing and keeps the authoritative safety workflow under existing fail-closed and human-authority controls.

## Consequences

The architecture keeps external routing useful while containing vendor, privacy and availability risk. ROS can switch providers without changing domain logic. Provider-specific licensing, billing, residency and credential approval remain external governance gates.

## Current provider references

- Google Routes `computeRoutes`: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
- Traffic options: https://developers.google.com/maps/documentation/routes/traffic-opt

These references are implementation inputs, not authority to activate production or a public-road pilot.
