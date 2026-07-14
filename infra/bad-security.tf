# Intentional Security Violations for Agentic DevOps Showcase

resource "aws_s3_bucket" "unencrypted_public_bucket" {
  bucket = "aerostack-public-data-bucket-showcase"
}

resource "aws_s3_bucket_public_access_block" "public_access" {
  bucket = aws_s3_bucket.unencrypted_public_bucket.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_security_group" "open_ssh" {
  name        = "allow_all_ssh"
  description = "Intentionally bad SG allowing 0.0.0.0/0 to port 22"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH from anywhere"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
