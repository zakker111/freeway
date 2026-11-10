# Security policy

## Supported versions

Security fixes are applied to the current 2.23.x line and the most recent published
release. Older builds are unsupported; rebuild from the current source.

## Reporting a vulnerability

Please report vulnerabilities privately. Do not open a public issue containing
vulnerability details, and never include API keys, GitHub tokens, provider account IDs,
chat contents or other personal data in a report.

Use GitHub's private vulnerability reporting form:

<https://github.com/zakker111/freeway/security/advisories/new>

If that form is unavailable, open a minimal issue titled **Security contact request**
with no vulnerability details and ask the maintainer for a private channel.

Please include:

- the affected edition (desktop or hosted cloud) and version or commit;
- the smallest reproduction you can share safely;
- the impact you believe is possible; and
- any suggested fix or mitigation.

I aim to acknowledge reports within three business days, confirm the affected scope,
and coordinate disclosure after a fix is available. There is no bug bounty.

## Scope

In scope: the desktop server and workspace tools, the Cloudflare Worker and browser
page, preview isolation, provider proxying, credential handling, and the GitHub
Actions workflows in this repository.

Out of scope: vulnerabilities in third-party providers, Cloudflare, GitHub, or a
provider's model output. Report those to the affected provider. General support
questions belong in a normal issue, not the security channel.

## Handling secrets

If you suspect a credential was exposed, revoke and replace it at the provider. Do not
paste the value into an issue, a chat, or a test fixture. Deleting a file or commit does
not invalidate a key that was already exposed.
