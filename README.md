# promotions

This branch holds `stable.json`: the exact set of releases the **stable** yum
channel serves (https://vagrantin.github.io/xoa-hl/8.3/x86_64/), the repository
every XOA-HL appliance updates from. The Pages workflow reads it at the start of
every run and verifies each asset's SHA-256.

Only the Jenkins promotion job (`prod/promote`, and `prod/demote` for candidates)
writes here, after QA and a human approval. Entries with
`"basis": "legacy-baseline"` were already served when the gate was introduced
(2026-10-07) and were not approved by it. A broken stable build is fixed forward
(`"status": "superseded"`), never removed. Design: jenkins-infra
`docs/promotion-gate.md`, Vagrantin/xcp-hl#179.
