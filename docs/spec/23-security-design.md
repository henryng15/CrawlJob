# 23. Security Design

## 23.1 Network

- OCI security list exposes only restricted SSH during bootstrap.
- App binds to loopback through Caddy.
- Tailscale Serve provides private HTTPS.
- no Docker service publishes a public port.
- PostgreSQL is internal only.
- Browser debugging ports are internal only.
- Tailscale Funnel is disabled.

## 23.2 Authentication

Recommended:

- require a local admin login even inside Tailscale;
- secure cookie;
- `HttpOnly`;
- `SameSite=Strict`;
- short idle timeout;
- optional TOTP.

Optionally use verified Tailscale identity headers, but only when:

- traffic can reach the app only through Tailscale Serve;
- proxy headers are stripped from untrusted sources;
- the backend trusts only the local proxy.

## 23.3 Secrets

Secret storage hierarchy:

1. OCI Vault optional;
2. encrypted files on `/data`;
3. Docker secrets;
4. permission-restricted `.env` only for non-rotating low-risk config.

At minimum:

```bash
chmod 700 /data/internship-ops/secrets
chmod 600 /data/internship-ops/secrets/*
```

## 23.4 Browser security

- run Chromium as non-root;
- enable Chromium sandbox where compatible;
- use a seccomp profile;
- do not evaluate page-supplied code outside browser isolation;
- restrict file mounts;
- only mount the current application's artifact directory when practical;
- clear clipboard after session;
- do not retain passwords in screenshots;
- mask sensitive inputs in logs.

## 23.5 Logging

Never log:

- full resume text at info level;
- passwords;
- cookies;
- OAuth refresh tokens;
- API keys;
- full street address;
- SSN;
- demographic answers;
- raw application POST bodies.

Use structured event IDs and redaction.

## 23.6 Data retention

Suggested:

| Data | Retention |
|---|---|
| Job source records | 12 months |
| Applications | Indefinite until user deletes |
| Tailored resumes | Indefinite until user deletes |
| Pre-submit screenshots | 30 days |
| Confirmation screenshots | 12 months |
| Browser storage state | Delete 7 days after submission |
| Live profiles | Rotate after session |
| Logs | 30 days |
| Backup snapshots | 14 daily + 8 weekly |
| Suppression list | Indefinite |

---
