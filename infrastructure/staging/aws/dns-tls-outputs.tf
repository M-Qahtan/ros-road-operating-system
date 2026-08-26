output "private_dns_zone_name" {
  description = "Private-use DNS zone for temporary Frankfurt staging only."
  value       = local.private_dns_zone_name
}

output "api_private_fqdn" {
  description = "TLS server name for the internal ROS staging API endpoint."
  value       = local.api_private_fqdn
}

output "api_private_https_url" {
  description = "Private-only HTTPS URL for the synthetic/non-sensitive staging API."
  value       = "https://${local.api_private_fqdn}"
}
