# Validation Notes

The connector-based implementation created the reliability branch and commit history directly on GitHub. Mandatory runtime verification is delegated to the repository CI jobs introduced in this change. The pull request must not merge until all jobs, including `operational-readiness`, succeed.
