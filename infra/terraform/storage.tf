# The data volume (spec §17.8).
#
# Separate from the boot volume on purpose: §17.1 warns that Always Free compute
# can be reclaimed, so the instance is disposable and this is not. Detaching it
# and attaching it to a fresh instance is the documented recovery path.

resource "oci_core_volume" "data" {
  availability_domain = oci_core_instance.app.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "${var.instance_name}-data"
  size_in_gbs         = var.data_volume_size_in_gbs

  freeform_tags = local.tags

  lifecycle {
    # Everything the user owns lives here. Terraform must never be one careless
    # rename away from deleting it.
    prevent_destroy = true
  }
}

resource "oci_core_volume_attachment" "data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.app.id
  volume_id       = oci_core_volume.data.id
}

# Five Always Free volume backups exist (§17.1). They are a second line, not the
# first: §24 keeps encrypted application-level backups on /data and off-instance,
# because a volume snapshot of a corrupted database is a corrupted database.
resource "oci_core_volume_backup_policy" "data" {
  compartment_id = var.compartment_ocid
  display_name   = "${var.instance_name}-weekly"

  schedules {
    backup_type       = "INCREMENTAL"
    period            = "ONE_WEEK"
    day_of_week       = "SUNDAY"
    hour_of_day       = 4
    retention_seconds = 60 * 60 * 24 * 28
    time_zone         = "UTC"
  }

  freeform_tags = local.tags
}

resource "oci_core_volume_backup_policy_assignment" "data" {
  asset_id  = oci_core_volume.data.id
  policy_id = oci_core_volume_backup_policy.data.id
}
