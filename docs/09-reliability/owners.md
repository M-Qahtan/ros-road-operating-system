# Reliability and release ownership

| Control | Accountable owner | Execution owner | Required consultation |
|---|---|---|---|
| Life-safety invariants and residual risk | Founder or delegated Safety Authority | Safety Lead | Medical, legal, human-factors, government operations as applicable |
| CI, build, test, and evidence integrity | Platform/DevOps Owner | CI maintainer | Security and Release Manager |
| PostgreSQL/PostGIS backup and restore | Data Reliability Owner | Database engineer | Security and Safety Lead |
| Staging fault injection and readiness | Reliability Owner | SRE/Platform engineer | Application owners |
| Security, secrets, dependencies, and SBOM | Security Owner | Security engineer | Platform and Release Manager |
| Privacy, consent, retention, and observability | Privacy Owner | Data governance engineer | Security, Legal, Safety Lead |
| Riyadh E2E and failure-mode evidence | Test/Safety Assurance Owner | QA and safety-test engineer | Domain and operations owners |
| Final operational-readiness decision | Release Manager | Release engineer | All control owners |
| Production or government activation | Founder and authorized government authority | Designated operations command | Safety, security, privacy, legal, medical governance |

No individual may approve their own unreviewed residual-risk acceptance for a P0/P1 safety control. Where the team has one GitHub account, technical automation remains mandatory and strategic or residual-risk decisions remain explicitly recorded by the founder.
