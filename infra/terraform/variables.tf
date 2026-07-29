# Inputs (spec §17).
#
# Everything that varies between tenancies, and nothing that does not. A variable
# for something with one correct value is a way to get it wrong.

variable "tenancy_ocid" {
  description = "OCID of your OCI tenancy"
  type        = string
}

variable "user_ocid" {
  description = "OCID of the user whose API key signs these requests"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment to build in. The tenancy root works for a personal account."
  type        = string
}

variable "api_key_fingerprint" {
  description = "Fingerprint of the API signing key, shown next to it in the console"
  type        = string
}

variable "api_private_key_path" {
  description = "Path to the API private key PEM. Read from disk so it stays out of state."
  type        = string
  default     = "~/.oci/oci_api_key.pem"
}

variable "region" {
  description = "Home region of the tenancy. Always Free resources exist only there."
  type        = string
}

variable "ssh_public_key_path" {
  description = "Public key authorised for the bootstrap SSH user"
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "admin_cidr" {
  description = <<-EOT
    The only source allowed to reach port 22, and only during bootstrap (§17.2).
    Your current address with /32, never 0.0.0.0/0 — this instance holds every
    locked fact you own, and SSH open to the internet is how that leaves.
  EOT
  type        = string

  validation {
    condition     = var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must not be 0.0.0.0/0. Use your own address with /32."
  }
}

variable "instance_name" {
  description = "Display name for the instance and its volume"
  type        = string
  default     = "internship-ops"
}

variable "ocpus" {
  description = "A1 cores. The Always Free allocation is 4 across the tenancy; §17.1 uses 2."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "A1 memory. Always Free allows 24 GB across the tenancy; §17.1 uses 12."
  type        = number
  default     = 12
}

variable "boot_volume_size_in_gbs" {
  description = "Boot volume. 50 leaves headroom in the 200 GB Always Free block allocation."
  type        = number
  default     = 50
}

variable "data_volume_size_in_gbs" {
  description = "Volume mounted at /data: Postgres, artifacts, backups, browser profiles."
  type        = number
  default     = 100

  validation {
    condition     = var.data_volume_size_in_gbs >= 50
    error_message = "Postgres, artifacts and 14 daily backups need at least 50 GB."
  }
}

variable "availability_domain_index" {
  description = <<-EOT
    Which AD to try. A1 capacity varies by domain, and "Out of host capacity" on
    one often succeeds on another — changing this is the first thing to try.
  EOT
  type        = number
  default     = 0
}

variable "assign_public_ip" {
  description = <<-EOT
    Needed for bootstrap and for outbound package installs. §17.2 allows turning
    public SSH off once Tailscale SSH works; the address itself stays, because
    nothing listens on it (§23.1).
  EOT
  type        = bool
  default     = true
}

variable "enable_public_ssh" {
  description = <<-EOT
    Set false once Tailscale SSH is verified. From then on there is no public
    ingress at all, which is what §17.2 asks for at steady state.
  EOT
  type        = bool
  default     = true
}

variable "tailscale_auth_key" {
  description = <<-EOT
    Optional ephemeral, pre-authorised Tailscale key. When set, cloud-init joins
    the tailnet on first boot and you never need the public SSH path at all.
    Marked sensitive; it still lands in state, so use a single-use key.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}
