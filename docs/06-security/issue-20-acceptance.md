# Issue #20 acceptance mapping

- Reusable credential material removed from workflow YAML: CI service credentials are derived per run and are test-only.
- Third-party actions immutable: all workflow action references use reviewed commit SHAs.
- Dependency and secret scans: the Security workflow blocks critical dependency findings and tracked-file credential patterns.
- SBOM evidence: a CycloneDX document is generated and uploaded with the commit SHA.
- Environment separation: local, CI, staging and production secret sources and rotation are documented.
- Least privilege: workflow permissions default to read-only and checkout does not persist credentials.

Closes #20 after required checks pass and branch protection is configured according to the documented merge gates.
