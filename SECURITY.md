# Security policy

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue.

Include what you found, how to reproduce it, and its impact. You'll get an acknowledgement within a few days, and a fix or a plan once it's confirmed. Credit is given in the release notes unless you'd rather not.

## Scope

In scope: the API, the web app, the Chrome extension, and the self-hosting setup in this repository. For example: authentication or session flaws, one account reading or changing another's data, CSRF, injection, exposure of encrypted fields or AI keys, or the extension reading more than it says it does.

Out of scope: denial of service by volume, findings that need a compromised device or server, and issues in third-party services (AI providers, mail providers, job sites).

## Supported versions

The latest release. Self-hosters should upgrade to get fixes ([docs/UPGRADING.md](docs/UPGRADING.md)).

## How data is protected

See the security and privacy section of the [README](README.md#security-and-privacy), [PRIVACY.md](PRIVACY.md) and the [architecture decisions](docs/adr/README.md).
