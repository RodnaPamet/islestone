# DAST findings

The nightly OWASP ZAP baseline scan (`.github/workflows/dast.yml`) reports
URL-scoped findings. GitHub code scanning needs every SARIF result to point at
a file in the repository, so `.zap/zap-json-to-sarif.mjs` anchors each one
here; the URL is in the result's message. Triage is described in
`docs/deployment.md`, "Security scans".
