# VCN, gateway, routing and the security list (spec §17.2, §17.6).
#
# The security list is the part that matters. There is exactly one ingress rule,
# it is SSH, and it is restricted to a single address — no rule exists for 8000,
# 8080, 6080, 5432 or any browser port, because those are reached over Tailscale
# and nothing else (§23.1).

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.20.0.0/16"]
  display_name   = var.instance_name
  dns_label      = "internshipops"

  freeform_tags = local.tags
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.instance_name}-igw"
  enabled        = true

  freeform_tags = local.tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.instance_name}-public"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }

  freeform_tags = local.tags
}

resource "oci_core_security_list" "app" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${var.instance_name}-app"

  # Outbound is unrestricted: package repositories, job boards, the Anthropic API
  # and Gmail are all needed, and enumerating them would be a list that rots.
  egress_security_rules {
    protocol         = "all"
    destination      = "0.0.0.0/0"
    destination_type = "CIDR_BLOCK"
  }

  # Bootstrap SSH. Removed entirely once Tailscale SSH is verified, at which
  # point this list has no ingress rules at all.
  dynamic "ingress_security_rules" {
    for_each = var.enable_public_ssh ? [1] : []

    content {
      protocol    = "6" # TCP
      source      = var.admin_cidr
      source_type = "CIDR_BLOCK"
      description = "Bootstrap SSH from the operator only"

      tcp_options {
        min = 22
        max = 22
      }
    }
  }

  # ICMP for path-MTU discovery. Without it, large responses hang rather than
  # fail, which is a miserable thing to debug.
  ingress_security_rules {
    protocol    = "1"
    source      = "10.20.0.0/16"
    source_type = "CIDR_BLOCK"
    description = "Path MTU discovery within the VCN"

    icmp_options {
      type = 3
      code = 4
    }
  }

  freeform_tags = local.tags
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = "10.20.10.0/24"
  display_name               = "${var.instance_name}-public"
  dns_label                  = "public"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.app.id]
  prohibit_public_ip_on_vnic = false

  freeform_tags = local.tags
}
