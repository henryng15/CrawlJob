# 18. Post-Provision Setup

## 18.1 Local prerequisites

On the user's Windows machine with WSL:

```text
Git
Terraform
OCI CLI optional
OpenSSH
Tailscale client
Claude Code
```

## 18.2 OCI setup

1. Create OCI account.
2. Confirm the home region.
3. Create a compartment such as `internship-ops`.
4. Generate an OCI API signing key.
5. Upload the public key to OCI.
6. Record:
   - tenancy OCID;
   - user OCID;
   - compartment OCID;
   - region;
   - key fingerprint.
7. Generate an SSH key for the VM.

## 18.3 Apply infrastructure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Fill only the local uncommitted file.

terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
```

## 18.4 Connect Tailscale

SSH to the VM using the restricted public-IP rule.

Install/connect:

```bash
sudo tailscale up --hostname=internship-ops --ssh
```

Use interactive login for the first deployment.

After Tailscale works:

1. verify Tailscale SSH;
2. verify MagicDNS;
3. optionally remove public SSH ingress via Terraform;
4. configure Tailscale Serve:

```bash
sudo tailscale serve --bg 8080
```

The private URL will use the tailnet DNS name, for example:

```text
https://internship-ops.<tailnet>.ts.net
```

No purchased domain is required.

## 18.5 Deploy application

Recommended repository path:

```text
/opt/internship-ops
```

Persistent data:

```text
/data/internship-ops
```

Steps:

```bash
sudo mkdir -p /opt/internship-ops
sudo chown internshipops:internshipops /opt/internship-ops

git clone <PRIVATE_REPOSITORY_URL> /opt/internship-ops
cd /opt/internship-ops

cp .env.example .env
chmod 600 .env
```

Then:

```bash
docker compose build
docker compose run --rm web alembic upgrade head
docker compose up -d
docker compose ps
```

## 18.6 Gmail OAuth

Recommended flow:

1. Create a Google Cloud project.
2. Enable Gmail API.
3. Configure OAuth consent for personal use.
4. Create a Desktop OAuth client.
5. Run a local authorization helper on the user's laptop.
6. Grant the minimum scope needed:
   - `gmail.compose` for draft creation;
   - add `gmail.modify` only if reconciliation requires it.
7. Encrypt the refresh token using the app master key.
8. Transfer the encrypted token to the server.
9. Delete plaintext temporary token files.

Do not put OAuth client secret or refresh token into Git.

## 18.7 Candidate profile and resume

The initial setup wizard must:

1. import the base resume;
2. require user verification of structured facts;
3. mark legal/work-authorization fields locked;
4. generate a base resume from the structured template;
5. compare it visually to the user's original;
6. require user approval before tailoring is enabled.

## 18.8 Recruiter database

```bash
internship-ops import-recruiters recruiters.csv --preview
internship-ops import-recruiters recruiters.csv --commit
```

The preview must show:

- valid rows;
- invalid emails;
- duplicate emails;
- company normalization;
- fuzzy company matches;
- unresolved companies.

---
