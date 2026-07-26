# Reviewed GitHub Action pins

| Action | Reviewed release | Immutable commit |
|---|---:|---|
| `actions/checkout` | v4.2.2 | `11bd71901bbe5b1630ceea73d27597364c9af683` |
| `actions/setup-node` | v4.4.0 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` | v4.6.2 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |

Security review must verify the upstream release and commit signature before changing a pin. Version tags are documentation only and must not replace the immutable SHA in workflow execution. Dependency blocking is implemented with the repository package manager so it does not depend on an optional GitHub Advanced Security feature.
