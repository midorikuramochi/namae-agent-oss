# Security policy

Namae is an experimental local prototype and is **not hardened for untrusted internet traffic**.

## Supported scope

Security fixes are accepted for the current `main` branch. There is no production SLA or long-term support policy yet.

## Reporting a vulnerability

Please avoid posting API keys, credentials, private media, or exploit details in a public issue. If GitHub's private vulnerability reporting / Security Advisories are available for the repository, use that channel. Otherwise, open a minimal issue asking the maintainer for a private contact path without including sensitive details.

## Operator responsibilities

- Keep `.env` and cloud credentials out of Git.
- Review the configured Gemini / Vertex AI provider's data-handling terms before sending sensitive media.
- Do not expose the development server directly to the public internet without adding authentication, rate limiting, request validation, logging/retention controls, and deployment-specific hardening.
- Treat model output and grounded links as untrusted external content until verified.
