# Outputs (spec §17.9).
#
# No secret is emitted. Terraform outputs land in state and in CI logs, so the
# Tailscale key and the private key path are deliberately absent.

output "instance_id" {
  description = "OCID of the instance"
  value       = oci_core_instance.app.id
}

output "public_ip" {
  description = "Bootstrap address. Nothing listens on it but SSH, and only from admin_cidr."
  value       = oci_core_instance.app.public_ip
}

output "private_ip" {
  value = oci_core_instance.app.private_ip
}

output "availability_domain" {
  description = "Useful when A1 capacity fails and you try another domain."
  value       = oci_core_instance.app.availability_domain
}

output "data_volume_id" {
  value = oci_core_volume.data.id
}

output "ssh_command" {
  description = "How to reach it during bootstrap"
  value       = "ssh ubuntu@${oci_core_instance.app.public_ip}"
}

output "next_steps" {
  value = <<-EOT
    1. ssh ubuntu@${oci_core_instance.app.public_ip}
    2. sudo tailscale up --ssh          (skip if tailscale_auth_key was set)
    3. cloud-init status --wait
    4. Verify /data is mounted:  df -h /data
    5. Clone the repo, write .env, then:
         docker compose -f docker-compose.prod.yml up -d --build
         sudo tailscale serve --bg 8080
    6. Once Tailscale SSH works, set enable_public_ssh = false and re-apply.
  EOT
}
