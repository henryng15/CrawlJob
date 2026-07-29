# OCI infrastructure

One Ampere A1 instance, a 100 GB data volume, and a network with **no public
application ports**. Everything is reached over Tailscale (§17.2, §23.1).

## Before you start

You need an Oracle Cloud account and about fifteen minutes in the console.

### 1. Find your OCIDs

- **Tenancy**: profile menu (top right) → *Tenancy* → copy the OCID.
- **User**: profile menu → *My profile* → copy the OCID.
- **Compartment**: the tenancy OCID works for a personal account.
- **Region**: shown in the top bar. It must be your **home** region — Always Free
  resources exist only there, and an apply against another region fails in a way
  that reads like a quota problem.

### 2. Create an API signing key

*My profile* → *API keys* → *Add API key* → *Generate API key pair*.

Download the private key, then:

```bash
mkdir -p ~/.oci && mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem
chmod 600 ~/.oci/oci_api_key.pem
```

Copy the fingerprint shown on the confirmation screen.

### 3. Fill in your variables

```bash
cp terraform.tfvars.example terraform.tfvars
curl -s https://api.ipify.org      # your address, for admin_cidr
```

`terraform.tfvars` is gitignored. It must stay that way.

## Apply

```bash
terraform init
terraform plan -out=tfplan     # read this; it creates real resources
terraform apply tfplan
```

Then follow the `next_steps` output.

## About A1 capacity

Ampere capacity is genuinely scarce, and this is the step most likely to fail:

```
Out of host capacity.
```

That is not a mistake in this configuration. In order of effectiveness:

1. **Change `availability_domain_index`** to 1, then 2. Capacity differs per
   domain and this alone often works.
2. **Upgrade the tenancy to Pay As You Go.** Free-tier resources still cost $0,
   but paid tenancies are served first. This is the single biggest improvement,
   and the spec's §17 does not mention it.
3. **Retry on a schedule.** Capacity frees up; a loop every few minutes for a day
   is normal. Do not create load to defeat idle-reclaim policies (§17.1).

## What this does not do

Terraform builds the machine. It does not deploy the application — that is
`docker compose -f docker-compose.prod.yml up -d --build` on the instance, and
the runbook covers it.

The data volume carries `prevent_destroy`. `terraform destroy` will refuse until
you remove that line, which is deliberate: the volume holds every application you
have ever prepared, and §17.1 says to expect the *instance* to be replaced, not
the data.

## Verifying it

```bash
terraform validate
terraform fmt -check -recursive
bash tests/test_mount_data_volume.sh
```

The last one is the important one. It renders the cloud-init template and runs the
disk-selection logic against stub devices, checking that an empty disk is
formatted, a disk with a filesystem is **not**, and an ambiguous case refuses
rather than guessing. §17.8 forbids identifying a disk by a guessed device name;
that test is what makes it a property rather than an intention.
