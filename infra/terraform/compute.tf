# The instance (spec §17.7).

locals {
  tags = {
    Project = "internship-ops"
    Tier    = "personal"
  }
}

resource "oci_core_instance" "app" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[
    var.availability_domain_index
  ].name
  compartment_id = var.compartment_ocid
  display_name   = var.instance_name
  shape          = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.public.id
    assign_public_ip = var.assign_public_ip
    hostname_label   = "internshipops"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_size_in_gbs
  }

  metadata = {
    ssh_authorized_keys = trimspace(file(pathexpand(var.ssh_public_key_path)))
    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml.tftpl", {
      # The image's own account, already holding the operator's SSH key.
      app_user           = "ubuntu"
      tailscale_auth_key = var.tailscale_auth_key
    }))
  }

  freeform_tags = local.tags

  lifecycle {
    # The image moves as Canonical publishes builds. Replacing a running instance
    # because of that would destroy /data's attachment and the tailnet identity,
    # for no benefit — patching happens in place through unattended-upgrades.
    ignore_changes = [source_details[0].source_id]
  }
}
