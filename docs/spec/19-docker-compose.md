# 19. Docker Compose

Recommended structure:

```yaml
services:
  postgres:
    image: postgres:16-bookworm
    restart: unless-stopped
    environment:
      POSTGRES_DB: internship_ops
      POSTGRES_USER: internship_ops
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - /data/internship-ops/postgres:/var/lib/postgresql/data
    networks: [internal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U internship_ops"]
      interval: 10s
      timeout: 5s
      retries: 10
    secrets:
      - postgres_password

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - /data/internship-ops/artifacts:/app/artifacts
      - /data/internship-ops/secrets:/app/secrets:ro
    networks: [internal]

  worker:
    build:
      context: .
      dockerfile: docker/worker.Dockerfile
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /data/internship-ops:/data/internship-ops
    networks: [internal]

  browser-slot-1:
    build:
      context: .
      dockerfile: docker/browser-arm64.Dockerfile
    restart: unless-stopped
    shm_size: "1gb"
    environment:
      SLOT_NAME: slot-1
      DISPLAY: ":99"
    volumes:
      - /data/internship-ops/browser-profiles/slot-1:/home/pwuser/profile
      - /data/internship-ops/browser-sessions/slot-1:/session
      - /data/internship-ops/artifacts:/artifacts
    networks: [internal]

  browser-slot-2:
    build:
      context: .
      dockerfile: docker/browser-arm64.Dockerfile
    restart: unless-stopped
    shm_size: "1gb"
    environment:
      SLOT_NAME: slot-2
      DISPLAY: ":99"
    volumes:
      - /data/internship-ops/browser-profiles/slot-2:/home/pwuser/profile
      - /data/internship-ops/browser-sessions/slot-2:/session
      - /data/internship-ops/artifacts:/artifacts
    networks: [internal]

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [web, browser-slot-1, browser-slot-2]
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
    networks: [internal]

networks:
  internal:
    driver: bridge

secrets:
  postgres_password:
    file: /data/internship-ops/secrets/postgres_password
```

Security note:

Mounting the Docker socket gives the worker significant host control. Prefer one of these:

1. fixed browser slots controlled over internal APIs, with no Docker socket; or
2. a restricted Docker socket proxy.

For MVP with fixed slots, **do not mount the Docker socket** unless necessary.

---
