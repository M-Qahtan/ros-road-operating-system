# Review checklist for CI gate changes

- Workflow triggers include pull requests and pushes to `main`.
- Required job names remain stable.
- Every required job uploads commit-addressed evidence.
- Evidence uploads execute even when the tested step fails.
- Merge controls and emergency bypass are documented.
- No product behavior or runtime scope is changed.
