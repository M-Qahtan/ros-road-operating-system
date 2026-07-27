# Validation boundary

The branch was assembled through the GitHub contents API because the execution environment did not provide an authenticated GitHub CLI or outbound DNS access for cloning the repository. GitHub Actions on the pull request is therefore the authoritative validation environment.

The pull request must not merge unless all required CI and Security jobs pass. In particular, review the generated CycloneDX document, secret-scan behavior, dependency audit, PostgreSQL clean restore target, and immutable action pins.
