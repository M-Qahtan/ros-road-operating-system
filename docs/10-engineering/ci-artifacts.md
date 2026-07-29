# CI artifacts

Required CI artifact names include the job, candidate head SHA, tested merge SHA, workflow run ID, and run attempt:

`job-candidateHead-testedMerge-run-attempt`

Every artifact contains a validated manifest with the same identities. Artifact publication never converts a failed test into success; missing or mismatched required evidence fails the job.
