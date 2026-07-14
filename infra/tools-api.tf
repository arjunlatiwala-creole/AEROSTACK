# Terraform translation of tools_stack.py

# DynamoDB Tables
resource "aws_dynamodb_table" "agent_registry" {
  name         = "aerostack-${var.environment}-agent-registry"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "agent_id"

  attribute {
    name = "agent_id"
    type = "S"
  }
  attribute {
    name = "agent_type"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "updated_at"
    type = "S"
  }

  global_secondary_index {
    name               = "by-type"
    hash_key           = "agent_type"
    range_key          = "updated_at"
    projection_type    = "ALL"
  }

  global_secondary_index {
    name               = "by-status"
    hash_key           = "status"
    range_key          = "updated_at"
    projection_type    = "ALL"
  }
}

resource "aws_dynamodb_table" "content" {
  name         = "aerostack-${var.environment}-content"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}

resource "aws_dynamodb_table" "knowledge_base" {
  name         = "aerostack-${var.environment}-knowledge-base"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}

# S3 Buckets
resource "aws_s3_bucket" "meeting_recordings" {
  bucket = "aerostack-zoom-recordings-${var.environment}"
}

resource "aws_s3_bucket" "content_assets" {
  bucket = "aerostack-content-assets-${var.environment}"
}

# API Gateway
resource "aws_api_gateway_rest_api" "tools_api" {
  name        = "aerostack-tools-api"
  description = "Aerostack Tools API Gateway"
}

# Lambda Example (Agent Registry)
resource "aws_lambda_function" "agent_registry_fn" {
  function_name    = "aerostack-AgentRegistryFn"
  handler          = "handler.handler"
  runtime          = "python3.13"
  
  # Note: A dummy package is referenced here. 
  # During the active provisioning showcase, the agent will configure the actual source code paths.
  filename         = "dummy.zip" 
  
  role             = aws_iam_role.lambda_exec.arn

  environment {
    variables = {
      STAGE                = var.environment
      AGENT_REGISTRY_TABLE = aws_dynamodb_table.agent_registry.name
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name = "aerostack_lambda_exec_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}
