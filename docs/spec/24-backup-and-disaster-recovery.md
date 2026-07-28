# 24. Backup and Disaster Recovery

## 24.1 Nightly backup

Create:

```text
postgres-YYYY-MM-DD.dump.zst.age
artifacts-manifest-YYYY-MM-DD.json.zst.age
config-YYYY-MM-DD.tar.zst.age
```

Upload to OCI Object Storage.

Do not upload active browser cookies unless explicitly encrypted and necessary.

## 24.2 Backup encryption

Use `age` with a user-controlled public key.

The private decryption key should not live on the server.

## 24.3 Restore test

Once per month:

1. create a temporary local PostgreSQL instance;
2. restore the latest dump;
3. verify row counts;
4. verify resume checksums;
5. verify recruiter data;
6. record restore test in `backup_audit`.

## 24.4 VM replacement

The system must be recoverable from:

- Terraform;
- private Git repository;
- encrypted Object Storage backups;
- local secret backup held by the user.

---
