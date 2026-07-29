# Final CI checklist

- Pull-request and push-to-`main` triggers confirmed.
- SHA-pinned actions and non-persisted checkout credentials preserved.
- Per-run CI credentials preserved.
- Required CI and Security job names stable.
- Evidence tied to candidate head, candidate base, and tested merge SHAs.
- Missing-file and mismatched-SHA validation fails closed.
- Active `main` ruleset and deliberate merge-blocking test recorded.
- Emergency bypass remains documented and exceptional.
