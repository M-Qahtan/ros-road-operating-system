# Gate B Negative Merge-Block Proof

This branch is an isolated governance test candidate for WP-00 Gate B.

It is intentionally non-mergeable. The only deliberate failure is the required `verify` status check, scoped in `scripts/verify-repository.mjs` to GitHub Actions workflow `CI`, job `verify`, and branch `gate-b/negative-merge-block-proof`.

Do not merge this branch. Do not use it as a product or release change.
