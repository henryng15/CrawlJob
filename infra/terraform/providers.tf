# API-key authentication from the operator's machine (spec §17.5).
#
# Values come from terraform.tfvars, which is gitignored. The private key is read
# from a path rather than a variable so its contents never enter Terraform state
# (§17.4: secrets absent from state).

provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.api_key_fingerprint
  private_key_path = var.api_private_key_path
  region           = var.region
}
