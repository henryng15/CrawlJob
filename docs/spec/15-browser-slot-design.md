# 15. Browser Slot Design

## 15.1 Slot services

Each browser slot container contains:

```text
Xvfb display
Window manager
Chromium
Playwright control service
x11vnc
websockify
noVNC static client
health endpoint
```

Internal ports per slot:

| Purpose | Slot 1 | Slot 2 |
|---|---:|---:|
| Playwright control | 9221 | 9222 |
| noVNC | 6081 | 6082 |
| Health | 7081 | 7082 |

These ports must only exist on the Docker network.

## 15.2 Caddy routes

Example:

```caddyfile
:8080 {
    encode zstd gzip

    handle_path /review/slot-1/* {
        reverse_proxy browser-slot-1:6080
    }

    handle_path /review/slot-2/* {
        reverse_proxy browser-slot-2:6080
    }

    handle {
        reverse_proxy web:8000
    }
}
```

Caddy binds to host loopback only:

```yaml
ports:
  - "127.0.0.1:8080:8080"
```

Tailscale Serve exposes the loopback service privately:

```bash
tailscale serve --bg 8080
```

Do not use Tailscale Funnel.

## 15.3 Review authorization

A noVNC path must require:

- authenticated InternshipOps session;
- application-specific signed token;
- token expiry;
- application-to-slot match;
- CSRF-safe link generation.

Caddy alone is not enough. The web app should generate a short-lived review token and the browser-control service should validate it before proxying the noVNC page.

## 15.4 Session retention policy

```yaml
browser:
  worker_count: 2
  live_review_slots: 2
  maximum_review_queue: 10
  live_session_ttl_hours: 8
  maximum_session_ttl_hours: 24
  idle_live_session_minutes: 90
  replay_enabled: true
```

Retention order:

1. user-pinned session;
2. session currently open;
3. application with near-term deadline;
4. newest ready application;
5. oldest non-pinned session moves to replay.

## 15.5 Memory policy

The system should not promise all 10 applications are instantly live on OCI Free.

Default:

- 2 live sessions;
- 8 replay packages.

Add a memory watchdog:

- warn at 75% RAM;
- stop new browser allocation at 82%;
- move an idle session to replay at 85%;
- restart an unhealthy slot at 90%;
- never let the host enter swap thrashing.

Configure a small swap file for emergency recovery, not normal browser capacity.

---
