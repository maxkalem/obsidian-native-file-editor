# Terraform: one bucket with versioning
terraform {
  required_version = ">= 1.5"
}

variable "name" {
  type    = string
  default = "notes-backup"
}

resource "aws_s3_bucket" "notes" {
  bucket = var.name
  tags = {
    Project = "vault"
    Count   = 3
  }
}

resource "aws_s3_bucket_versioning" "notes" {
  bucket = aws_s3_bucket.notes.id
  versioning_configuration {
    status = "Enabled"
  }
}
