# Initial GitHub Issues

These are the first execution issues to create after publishing the repository.

## P0 Foundation

1. **[P0] Establish monorepo CI and protected main branch**  
   Outcome: lint, typecheck, tests and verification run on every pull request.

2. **[P0] Implement RoadEvent persistence and optimistic locking**  
   Outcome: aggregate state is stored transactionally with version checks.

3. **[P0] Implement transactional outbox worker**  
   Outcome: domain events cannot be lost after business state commits.

4. **[P0] Implement signal ingestion and idempotency**  
   Outcome: every signal is validated, normalized and accepted once.

5. **[P0] Implement RoadEvent correlation baseline**  
   Outcome: geographic, temporal, road-segment and direction rules produce explainable match scores.

6. **[P0] Implement severity rules with reason codes**  
   Outcome: every severity result is explainable and high/critical cases require human review.

7. **[P0] Implement safety conversation state machine**  
   Outcome: short safety flow, persisted responses and no-response escalation.

8. **[P0] Implement operator acknowledgement and SLA timers**  
   Outcome: critical events escalate when not acknowledged within the approved SLA.

9. **[P0] Implement immutable RoadEvent timeline and audit log**  
   Outcome: sensitive actions can be reconstructed with actor, reason and trace ID.

10. **[P0] Implement operations event queue and detail view**  
    Outcome: operators see severity-ranked events, safety state and timeline in real time.

## P1 Pilot operations

11. **[P1] Add agency simulation adapters**
12. **[P1] Add evidence upload, hashing and access audit**
13. **[P1] Add nearby hazard notifications and delivery tracking**
14. **[P1] Add failure-injection scenarios and operational runbooks**
