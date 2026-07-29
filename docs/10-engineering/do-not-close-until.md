# Do not close issue #19 until

- all protected CI and Security checks run on the current candidate;
- the active `main` ruleset blocks a deliberately failing candidate;
- each required CI artifact passes fail-closed file and manifest validation;
- candidate head, candidate base, and tested merge SHAs match the pull-request event;
- no required check is missing, skipped, cancelled, stale, or failed.
