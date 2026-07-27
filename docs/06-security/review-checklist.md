# Security PR review checklist

- [ ] All GitHub Actions references use immutable SHAs with reviewed version comments.
- [ ] CI credentials are unique per run and unusable outside CI.
- [ ] No workflow gains write permissions without a documented requirement.
- [ ] Critical dependency findings fail the workflow.
- [ ] Secret findings fail the workflow without printing secret values.
- [ ] SBOM output is valid JSON and tied to the commit SHA and lockfile digest.
- [ ] All CI, integration, smoke and Riyadh E2E jobs pass.
- [ ] Branch protection requires the documented checks before merge.
