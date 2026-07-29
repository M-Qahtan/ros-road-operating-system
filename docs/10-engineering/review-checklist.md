# Review checklist for CI gate changes

- Workflow triggers include pull requests and pushes to `main`.
- Required job names remain stable.
- Third-party actions remain pinned to reviewed immutable SHAs.
- Checkout credentials are not persisted.
- CI credentials remain per-run and test-only.
- Every required CI job validates and uploads commit-addressed evidence.
- Required evidence is fail-closed when files or identities are missing or mismatched.
- Security, SBOM, secret-scan, and dependency gates are preserved.
- Merge controls and emergency bypass are documented.
- No product behavior or runtime scope is changed.
