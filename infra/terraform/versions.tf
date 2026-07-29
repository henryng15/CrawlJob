# Provider versions (spec §17.4).
#
# Pinned exactly, not with a range. A provider upgrade that arrives on its own
# schedule is an upgrade nobody reviewed, and this stack is applied rarely enough
# that the churn is not worth the surprise.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "6.20.0"
    }
  }
}
