# Failure-Mode Safety Review Checklist

- [ ] All deterministic Node tests pass.
- [ ] The Riyadh safety workflow artifact is present for the PR head SHA.
- [ ] The artifact manifest SHA matches the reviewed commit.
- [ ] Conflicting, low-confidence, and late signals require human review.
- [ ] Stale concurrent writes fail without mutating the persisted winner.
- [ ] Duplicate and out-of-order notifications cannot duplicate operational intent.
- [ ] PostgreSQL, Redis, object storage, and network failures block unsafe closure.
- [ ] Tampered, missing, scanner-error, and cross-event evidence fail closed.
- [ ] An unanswered human-safety conversation escalates by deadline.
- [ ] Severity downgrade requires explicit human approval.
- [ ] S3/S4 closure requires supervisor authorization.
- [ ] Human safety, dependency health, and evidence preservation are all proven before reopening.
- [ ] No ML decision authority, real agency dispatch, medical diagnosis, or legal attribution was introduced.
