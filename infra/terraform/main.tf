# ---------------------------------------------------------------------------
# POLYGLOT INFRASTRUCTURE & BACKEND COMPUTING
#
# $0/mo inside the AWS Always Free Tier. VPC-free by design: there are NO VPCs,
# subnets, route tables, internet gateways, or NAT Gateways anywhere in this
# file — every resource talks over AWS-managed public endpoints.
#
#   viewers ──▶ CloudFront (14s edge cache on GET /api/v1/ticks/*)
#                   │
#                   ▼
#           HTTP API Gateway (versioned /api/v1 financial routes)
#                   │
#        ┌──────────┼───────────────┬──────────────┐
#        ▼          ▼               ▼              ▼
#  ticks-generator ticks-fetcher trading-api   assistant
#        │          │               │              │
#        │          ▼               ▼              ▼
#        │    DynamoDB         Aurora DSQL  pending_confirmations
#        │   (hot ticks)       (ledger)      (DynamoDB, TTL)
#        └───────▶ hourly-sync-engine (DynamoDB → DSQL, hourly)
# ---------------------------------------------------------------------------

locals {
  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  # CloudFront needs the origin hostname without the scheme.
  api_gateway_origin_domain = replace(aws_apigatewayv2_api.market_api.api_endpoint, "https://", "")
  dsql_endpoint             = "${aws_dsql_cluster.market_db.identifier}.dsql.${var.aws_region}.on.aws"
}

# ---------------------------------------------------------------------------
# Relational ledger — Aurora DSQL (serverless, single region)
# ---------------------------------------------------------------------------
resource "aws_dsql_cluster" "market_db" {
  deletion_protection_enabled = false
  tags                        = var.tags
}

# ---------------------------------------------------------------------------
# Price store — DynamoDB market_price_history
# PROVISIONED 1/1 RCU/WCU guarantees absolute $0 under the free tier.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "market_price_history" {
  name           = var.dynamodb_table_name
  billing_mode   = "PROVISIONED"
  read_capacity  = var.dynamodb_read_capacity
  write_capacity = var.dynamodb_write_capacity

  hash_key  = "symbol"
  range_key = "timestamp"

  attribute {
    name = "symbol"
    type = "S"
  }
  attribute {
    name = "timestamp"
    type = "N"
  }

  # TTL: every item carries ttl = tick timestamp + 24h, so DynamoDB natively
  # evicts data older than 24 hours at zero cost. (Using the raw timestamp as
  # the TTL attribute would expire items the instant their tick goes live and
  # DynamoDB would garbage-collect the history the fetcher + hourly sync read.)
  ttl {
    enabled        = true
    attribute_name = var.dynamodb_ttl_attribute
  }

  stream_enabled   = true
  stream_view_type = "NEW_IMAGE" # Captures only the final, complete new tick written to the row

  tags = var.tags
}

# ---------------------------------------------------------------------------
# Pending trade confirmations — DynamoDB pending_confirmations
# PROVISIONED 1/1 RCU/WCU stays $0 under the free tier. Items carry a `ttl`
# = createdAt + pending_confirmations_ttl_seconds so DynamoDB natively evicts
# stale confirmations at zero cost (reads also defend against TTL lag).
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "pending_confirmations" {
  name           = var.pending_confirmations_table_name
  billing_mode   = "PROVISIONED"
  read_capacity  = var.dynamodb_read_capacity
  write_capacity = var.dynamodb_write_capacity

  hash_key = "confirmationId"

  attribute {
    name = "confirmationId"
    type = "S"
  }

  ttl {
    enabled        = true
    attribute_name = "ttl"
  }

  tags = var.tags
}

# ---------------------------------------------------------------------------
# IAM roles — one per Lambda, least privilege, no VPC
# ---------------------------------------------------------------------------
resource "aws_iam_role" "ticks_generator_lambda" {
  name               = var.ticks_generator_role_name
  assume_role_policy = local.lambda_assume_role_policy
  tags               = var.tags
}

resource "aws_iam_role" "ticks_fetcher_lambda" {
  name               = var.ticks_fetcher_role_name
  assume_role_policy = local.lambda_assume_role_policy
  tags               = var.tags
}

resource "aws_iam_role" "trading_api_lambda" {
  name               = var.trading_api_role_name
  assume_role_policy = local.lambda_assume_role_policy
  tags               = var.tags
}

resource "aws_iam_role" "hourly_sync_lambda" {
  name               = var.hourly_sync_role_name
  assume_role_policy = local.lambda_assume_role_policy
  tags               = var.tags
}

resource "aws_iam_role" "assistant_lambda" {
  name               = var.assistant_role_name
  assume_role_policy = local.lambda_assume_role_policy
  tags               = var.tags
}

# --- ticks-generator: single batch write per minute ---------------------------
resource "aws_iam_role_policy" "ticks_generator_dynamodb" {
  name = "dynamodb-batch-write"
  role = aws_iam_role.ticks_generator_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:BatchWriteItem"]
        Resource = aws_dynamodb_table.market_price_history.arn
      }
    ]
  })
}

# --- ticks-fetcher: gated history reads -------------------------------------
resource "aws_iam_role_policy" "ticks_fetcher_dynamodb" {
  name = "dynamodb-query"
  role = aws_iam_role.ticks_fetcher_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = aws_dynamodb_table.market_price_history.arn
      }
    ]
  })
}

# --- trading-api: polyglot access (DynamoDB price + DSQL ledger) -------------
resource "aws_iam_role_policy" "trading_api_polyglot" {
  name = "polyglot-access"
  role = aws_iam_role.trading_api_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = aws_dynamodb_table.market_price_history.arn
      },
      {
        # DSQL is reached over the PostgreSQL wire protocol (port 5432) with an
        # IAM db-connect token, so the permission is dsql:Connect on the cluster
        # ARN — NOT an HTTP Data API ExecuteStatement.
        Effect = "Allow"
        Action = [
          "dsql:Connect",
          "dsql:DbConnectAdmin"
        ]
        Resource = aws_dsql_cluster.market_db.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
          "dynamodb:ListStreams"
        ]
        Resource = "${aws_dynamodb_table.market_price_history.arn}/stream/*"
      }
    ]
  })
}

# --- hourly-sync-engine: polyglot access (DynamoDB read + DSQL write) --------
resource "aws_iam_role_policy" "hourly_sync_polyglot" {
  name = "polyglot-access"
  role = aws_iam_role.hourly_sync_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = aws_dynamodb_table.market_price_history.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dsql:Connect",
          "dsql:DbConnectAdmin"
        ]
        Resource = aws_dsql_cluster.market_db.arn
      }
    ]
  })
}

# --- assistant: pending-confirmation CRUD on its own DynamoDB table ----------
resource "aws_iam_role_policy" "assistant_pending_confirmations" {
  name = "pending-confirmations"
  role = aws_iam_role.assistant_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan"
        ]
        Resource = aws_dynamodb_table.pending_confirmations.arn
      }
    ]
  })
}

# --- assistant: direct Lambda invocation (no CloudFront round-trip) ----------
# The assistant invokes trading-api and ticks-fetcher synchronously with
# @aws-sdk/client-lambda instead of routing back out through CloudFront.
resource "aws_iam_role_policy" "assistant_invoke_lambdas" {
  name = "invoke-trading-api-and-ticks-fetcher"
  role = aws_iam_role.assistant_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          aws_lambda_function.trading_api.arn,
          aws_lambda_function.ticks_fetcher.arn
        ]
      }
    ]
  })
}

# --- CloudWatch log write access for every Lambda ----------------------------
resource "aws_iam_role_policy_attachment" "ticks_generator_basic_execution" {
  role       = aws_iam_role.ticks_generator_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "ticks_fetcher_basic_execution" {
  role       = aws_iam_role.ticks_fetcher_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "trading_api_basic_execution" {
  role       = aws_iam_role.trading_api_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "hourly_sync_basic_execution" {
  role       = aws_iam_role.hourly_sync_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "assistant_basic_execution" {
  role       = aws_iam_role.assistant_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# Compute layer — 4x non-VPC Lambdas (Node 22 ESM, 128 MB)
# ---------------------------------------------------------------------------

data "archive_file" "ticks_generator_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/ticks-generator"
  output_path = "${path.module}/.build/ticks-generator.zip"
}

resource "aws_lambda_function" "ticks_generator" {
  function_name    = var.ticks_generator_function_name
  role             = aws_iam_role.ticks_generator_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = data.archive_file.ticks_generator_lambda.output_path
  source_code_hash = data.archive_file.ticks_generator_lambda.output_base64sha256

  environment {
    variables = {
      MARKET_TABLE       = var.dynamodb_table_name
      MARKET_SYMBOL      = var.market_symbol
      MARKET_BASE_PRICE  = tostring(var.market_base_price)
      MARKET_VOLATILITY  = tostring(var.market_volatility)
      MARKET_START_EPOCH = tostring(var.market_start_epoch)
      MARKET_SEED        = tostring(var.market_seed)
      TICK_TTL_SECONDS   = "86400"
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "ticks_generator_logs" {
  name              = "/aws/lambda/${var.ticks_generator_function_name}"
  retention_in_days = 1
  tags              = var.tags
}

data "archive_file" "ticks_fetcher_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/ticks-fetcher"
  output_path = "${path.module}/.build/ticks-fetcher.zip"
}

resource "aws_lambda_function" "ticks_fetcher" {
  function_name    = var.ticks_fetcher_function_name
  role             = aws_iam_role.ticks_fetcher_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = data.archive_file.ticks_fetcher_lambda.output_path
  source_code_hash = data.archive_file.ticks_fetcher_lambda.output_base64sha256

  environment {
    variables = {
      MARKET_TABLE    = var.dynamodb_table_name
      MARKET_SYMBOL   = var.market_symbol
      CF_SECRET_TOKEN = var.cloudfront_custom_secret_token
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "ticks_fetcher_logs" {
  name              = "/aws/lambda/${var.ticks_fetcher_function_name}"
  retention_in_days = 1
  tags              = var.tags
}

data "archive_file" "trading_api_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/trading-api"
  output_path = "${path.module}/.build/trading-api.zip"
}

resource "aws_lambda_function" "trading_api" {
  function_name    = var.trading_api_function_name
  role             = aws_iam_role.trading_api_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = data.archive_file.trading_api_lambda.output_path
  source_code_hash = data.archive_file.trading_api_lambda.output_base64sha256

  environment {
    variables = {
      DSQL_ENDPOINT      = local.dsql_endpoint
      DSQL_DATABASE      = var.dsql_database
      DSQL_USER          = var.dsql_user
      MARKET_TABLE       = var.dynamodb_table_name
      MARKET_SYMBOL      = var.market_symbol
      MARKET_BASE_PRICE  = tostring(var.market_base_price)
      ACCOUNT_START_CASH = tostring(var.account_start_cash)
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "price_stream_to_trading_api" {
  event_source_arn  = aws_dynamodb_table.market_price_history.stream_arn
  function_name     = aws_lambda_function.trading_api.arn
  starting_position = "LATEST" # Reads newly populated data variations moving forward
  batch_size        = 4        # Gathers up to 4 ticks per minute into a single invoke

  # Only wake up the trading engine for raw INSERT actions.
  # This ignores DynamoDB background TTL delete events, completely avoiding waste compute.
  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT"]
      })
    }
  }
}

resource "aws_cloudwatch_log_group" "trading_api_logs" {
  name              = "/aws/lambda/${var.trading_api_function_name}"
  retention_in_days = 1
  tags              = var.tags
}

data "archive_file" "hourly_sync_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/hourly-sync-engine"
  output_path = "${path.module}/.build/hourly-sync-engine.zip"
}

resource "aws_lambda_function" "hourly_sync_engine" {
  function_name    = var.hourly_sync_function_name
  role             = aws_iam_role.hourly_sync_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = data.archive_file.hourly_sync_lambda.output_path
  source_code_hash = data.archive_file.hourly_sync_lambda.output_base64sha256

  environment {
    variables = {
      DSQL_ENDPOINT    = local.dsql_endpoint
      DSQL_DATABASE    = var.dsql_database
      DSQL_USER        = var.dsql_user
      MARKET_TABLE     = var.dynamodb_table_name
      MARKET_SYMBOL    = var.market_symbol
      SYNC_POINT_COUNT = "240"
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "hourly_sync_logs" {
  name              = "/aws/lambda/${var.hourly_sync_function_name}"
  retention_in_days = 1
  tags              = var.tags
}

data "archive_file" "assistant_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../lambdas/assistant/dist"
  output_path = "${path.module}/.build/assistant.zip"
}

resource "aws_lambda_function" "assistant" {
  function_name    = var.assistant_function_name
  role             = aws_iam_role.assistant_lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = data.archive_file.assistant_lambda.output_path
  source_code_hash = data.archive_file.assistant_lambda.output_base64sha256

  environment {
    variables = {
      TRADING_API_FUNCTION_NAME         = aws_lambda_function.trading_api.function_name
      TICKS_FETCHER_FUNCTION_NAME       = aws_lambda_function.ticks_fetcher.function_name
      PENDING_CONFIRMATIONS_TABLE       = var.pending_confirmations_table_name
      PENDING_CONFIRMATIONS_TTL_SECONDS = tostring(var.pending_confirmations_ttl_seconds)
      LLM_BASE_URL                      = var.assistant_llm_base_url
      LLM_CHAT_PATH                     = var.assistant_llm_chat_path
      LLM_API_KEY                       = var.assistant_llm_api_key
      LLM_MODEL                         = var.assistant_llm_model
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "assistant_logs" {
  name              = "/aws/lambda/${var.assistant_function_name}"
  retention_in_days = 1
  tags              = var.tags
}

# ---------------------------------------------------------------------------
# EventBridge schedules
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "ticks_generator_schedule" {
  name                = var.ticks_generator_schedule_name
  description         = "Generate the 4 deterministic 15-second tick slots of the current minute."
  schedule_expression = "cron(* * * * ? *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "ticks_generator_lambda" {
  rule      = aws_cloudwatch_event_rule.ticks_generator_schedule.name
  target_id = "ticks-generator"
  arn       = aws_lambda_function.ticks_generator.arn
}

resource "aws_lambda_permission" "ticks_generator_eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ticks_generator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.ticks_generator_schedule.arn
}

resource "aws_cloudwatch_event_rule" "hourly_sync_schedule" {
  name                = var.hourly_sync_schedule_name
  description         = "Copy the last 240 DynamoDB price points into Aurora DSQL once per hour."
  schedule_expression = "cron(0 * * * ? *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "hourly_sync_lambda" {
  rule      = aws_cloudwatch_event_rule.hourly_sync_schedule.name
  target_id = "hourly-sync-engine"
  arn       = aws_lambda_function.hourly_sync_engine.arn
}

resource "aws_lambda_permission" "hourly_sync_eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.hourly_sync_engine.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.hourly_sync_schedule.arn
}

# ---------------------------------------------------------------------------
# Cache edge layer — HTTP API Gateway (versioned financial REST routes)
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "market_api" {
  name          = var.api_gateway_name
  description   = "Versioned financial REST API for the FAKE market."
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-amz-date", "authorization", "x-api-key", "x-amz-security-token"]
    max_age       = 300
  }

  tags = var.tags
}

resource "aws_apigatewayv2_stage" "market_api_default" {
  api_id      = aws_apigatewayv2_api.market_api.id
  name        = "$default"
  auto_deploy = true

  # Hard limits protect against budget overruns from public traffic
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  tags = var.tags
}

# --- Integrations (AWS_PROXY → Lambda, payload format 2.0) --------------------
resource "aws_apigatewayv2_integration" "ticks_generator" {
  api_id                 = aws_apigatewayv2_api.market_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.ticks_generator.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "ticks_fetcher" {
  api_id                 = aws_apigatewayv2_api.market_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.ticks_fetcher.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "trading_api" {
  api_id                 = aws_apigatewayv2_api.market_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.trading_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "assistant" {
  api_id                 = aws_apigatewayv2_api.market_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.assistant.invoke_arn
  payload_format_version = "2.0"
}

# --- Routes ----------------------------------------------------------------
resource "aws_apigatewayv2_route" "ticks_generator_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/ticks"
  target    = "integrations/${aws_apigatewayv2_integration.ticks_generator.id}"
}

resource "aws_apigatewayv2_route" "ticks_fetcher_4h_get" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "GET /api/v1/ticks/4h"
  target    = "integrations/${aws_apigatewayv2_integration.ticks_fetcher.id}"
}

resource "aws_apigatewayv2_route" "ticks_fetcher_latest_get" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "GET /api/v1/ticks/latest"
  target    = "integrations/${aws_apigatewayv2_integration.ticks_fetcher.id}"
}

resource "aws_apigatewayv2_route" "trading_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/trades"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "portfolio_get" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "GET /api/v1/portfolio"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "trades_get" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "GET /api/v1/trades"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "transfers_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/transfers"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "orders_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/orders"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "orders_get" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "GET /api/v1/orders"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "orders_cancel_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/orders/{orderId}/cancel"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "orders_process_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/orders/process"
  target    = "integrations/${aws_apigatewayv2_integration.trading_api.id}"
}

resource "aws_apigatewayv2_route" "assistant_post" {
  api_id    = aws_apigatewayv2_api.market_api.id
  route_key = "POST /api/v1/assistant"
  target    = "integrations/${aws_apigatewayv2_integration.assistant.id}"
}

# --- Let API Gateway invoke the Lambdas -------------------------------------
resource "aws_lambda_permission" "ticks_generator_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ticks_generator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.market_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ticks_fetcher_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ticks_fetcher.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.market_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "trading_api_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trading_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.market_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "assistant_apigw" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.assistant.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.market_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Cache edge layer — CloudFront in front of the API Gateway
# ---------------------------------------------------------------------------

# 14-second edge TTL for GET /api/v1/ticks/*. Query strings are excluded from
# the cache key (the fetcher resolves its window from the path and ignores
# them); only the Origin header is kept so CORS headers are never mixed across
# viewers.
resource "aws_cloudfront_cache_policy" "ticks_cache" {
  name        = "market-ticks-cache-policy"
  comment     = "14-second edge TTL for GET /api/v1/ticks/*"
  min_ttl     = var.cloudfront_ticks_cache_ttl
  default_ttl = var.cloudfront_ticks_cache_ttl
  max_ttl     = var.cloudfront_ticks_cache_ttl

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["Origin"]
      }
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# No caching anywhere else: POST /api/v1/ticks, POST /api/v1/trades, and
# GET /api/v1/portfolio must always reach the origin.
resource "aws_cloudfront_cache_policy" "no_cache" {
  name        = "market-no-cache-policy"
  comment     = "Disable caching for trade, portfolio, and POST routes"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_origin_request_policy" "market_api" {
  name    = "market-api-origin-request-policy"
  comment = "Forward only Origin and limit (trades need it) to the API Gateway origin"

  cookies_config {
    cookie_behavior = "none"
  }
  headers_config {
    header_behavior = "whitelist"
    headers {
      items = ["Origin"]
    }
  }
  query_strings_config {
    query_string_behavior = "whitelist"
    query_strings {
      items = ["limit"]
    }
  }
}

resource "aws_cloudfront_distribution" "market_edge" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "Edge cache in front of the market HTTP API"

  origin {
    domain_name = local.api_gateway_origin_domain
    origin_id   = "market-api-gateway"

    # Shared secret injected on every origin request so ticks-fetcher can tell
    # CloudFront-served traffic apart from callers hitting the API Gateway URL
    # directly. Managed by var.cloudfront_custom_secret_token (sensitive).
    custom_header {
      name  = "X-From-CloudFront"
      value = var.cloudfront_custom_secret_token
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "market-api-gateway"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.no_cache.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.market_api.id
    compress                 = true
  }

  # GET /api/v1/ticks/* only: CloudFront caches only GET/HEAD, so POST requests
  # on this path still pass through to the origin untouched.
  ordered_cache_behavior {
    path_pattern             = "/api/v1/ticks/*"
    target_origin_id         = "market-api-gateway"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.ticks_cache.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.market_api.id
    compress                 = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.tags
}
