# Lookups (spec §17.7).
#
# The image is resolved at plan time rather than pinned. A hard-coded OCID goes
# stale the moment Canonical publishes a new build, and the stale one stops being
# available without warning.

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id = var.compartment_ocid

  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"

  # Newest first. aarch64 is implied by filtering on the A1 shape, which is the
  # reliable way to get it — the image name does not always say.
  sort_by    = "TIMECREATED"
  sort_order = "DESC"
}
