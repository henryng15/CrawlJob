# 17. OCI Infrastructure

## 17.1 Expected Always Free allocation

Use one Ampere A1 Flex instance in the OCI tenancy home region:

```text
2 OCPU
12 GB RAM
Ubuntu Always Free eligible image
50 GB boot volume
100 GB attached data volume
```

This leaves approximately 50 GB of the documented 200 GB combined Always Free block-volume allocation unused as safety headroom.

OCI documentation also describes:

- 20 GB Always Free Object Storage;
- five Always Free volume backups;
- potential reclamation of idle Always Free compute instances.

The system must therefore:

- keep off-instance backups;
- assume the VM can be replaced;
- never store the only copy of application history on the VM;
- monitor OCI notices;
- document a paid-VM migration path.

Do not artificially generate useless load to defeat idle-resource policies.

## 17.2 Network design

```text
VCN: 10.20.0.0/16
Public subnet: 10.20.10.0/24
Internet Gateway
Route 0.0.0.0/0 → Internet Gateway
Instance public IP for outbound/bootstrap
```

Ingress:

- TCP 22 only from `admin_cidr` during bootstrap;
- no public ingress to 8000, 8080, 6081, 6082, 5432, or browser ports.

After Tailscale SSH is verified, optionally set public SSH ingress to disabled.

Egress:

- HTTPS/HTTP;
- DNS;
- NTP;
- required package repositories and APIs.

## 17.3 Infrastructure repository layout

```text
infra/
└── terraform/
    ├── versions.tf
    ├── providers.tf
    ├── variables.tf
    ├── data.tf
    ├── network.tf
    ├── compute.tf
    ├── storage.tf
    ├── outputs.tf
    ├── cloud-init.yaml.tftpl
    ├── terraform.tfvars.example
    └── README.md
```

## 17.4 Terraform versions

Example:

```hcl
terraform {
  required_version = ">= 1.8.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "8.23.0"
    }
  }
}
```

Before implementation, verify the current stable provider and pin it intentionally.

Commit:

```text
.terraform.lock.hcl
```

Do not commit:

```text
terraform.tfstate
terraform.tfstate.backup
terraform.tfvars
.terraform/
OCI private keys
```

## 17.5 Provider configuration

Use OCI API key authentication from the developer machine.

Example:

```hcl
provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.api_key_fingerprint
  private_key_path = var.api_private_key_path
  region           = var.region
}
```

Prefer environment variables or an uncommitted local `terraform.tfvars`.

## 17.6 Representative network resources

Claude should generate complete validated Terraform for:

```hcl
resource "oci_core_vcn" "main" { ... }
resource "oci_core_internet_gateway" "main" { ... }
resource "oci_core_route_table" "public" { ... }
resource "oci_core_security_list" "app" { ... }
resource "oci_core_subnet" "public" { ... }
```

Security-list requirements:

```hcl
ingress_security_rules {
  protocol = "6"
  source   = var.admin_cidr

  tcp_options {
    min = 22
    max = 22
  }
}
```

No application-port ingress rule is allowed.

## 17.7 Compute instance

Representative:

```hcl
resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "internship-ops"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = true
    hostname_label   = "internshipops"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = 50
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(var.ssh_public_key_path))
    user_data = base64encode(
      templatefile("${path.module}/cloud-init.yaml.tftpl", {
        app_user = "internshipops"
      })
    )
  }

  freeform_tags = {
    Project = "internship-ops"
    Tier    = "personal"
  }
}
```

Image lookup must filter for:

- Ubuntu;
- an Always Free eligible release;
- AArch64/ARM;
- a supported OS version.

Do not hard-code a stale image OCID.

## 17.8 Data block volume

Create a 100 GB volume and attach it paravirtualized.

```hcl
resource "oci_core_volume" "data" {
  availability_domain = oci_core_instance.app.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "internship-ops-data"
  size_in_gbs         = 100
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.app.id
  volume_id       = oci_core_volume.data.id
}
```

The bootstrap script must:

1. identify the attached unformatted disk safely;
2. refuse to format if a filesystem exists;
3. format as ext4 only on first boot;
4. mount by filesystem UUID at `/data`;
5. write an `/etc/fstab` entry;
6. create app directories;
7. set ownership and permissions.

Never identify a disk solely by a guessed device name.

## 17.9 Terraform outputs

Allowed outputs:

- instance public IP;
- instance OCID;
- data volume OCID;
- SSH command template.

Sensitive outputs are prohibited.

## 17.10 Cloud-init responsibilities

Cloud-init should only:

- create application user;
- update packages;
- install baseline packages;
- install Docker;
- enable Docker;
- install Tailscale package;
- create directories;
- install fail2ban if public SSH remains enabled;
- configure host firewall;
- install a bootstrap placeholder.

Cloud-init must not contain:

- Tailscale auth key;
- Gmail token;
- Anthropic key;
- database password;
- app master key.

---
