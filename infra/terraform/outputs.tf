output "dynamodb_table_name" {
  description = "Name of the market_price_history DynamoDB table."
  value       = aws_dynamodb_table.market_price_history.name
}

output "dynamodb_table_arn" {
  description = "ARN of the market_price_history DynamoDB table."
  value       = aws_dynamodb_table.market_price_history.arn
}

output "api_gateway_endpoint" {
  description = "Base URL of the HTTP API Gateway (execute-api)."
  value       = aws_apigatewayv2_api.market_api.api_endpoint
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name (preferred entry point)."
  value       = aws_cloudfront_distribution.market_edge.domain_name
}

output "ticks_endpoint" {
  description = "GET /api/v1/ticks/4h — last 4h of 15s ticks through the CloudFront edge."
  value       = "https://${aws_cloudfront_distribution.market_edge.domain_name}/api/v1/ticks/4h"
}

output "latest_ticks_endpoint" {
  description = "GET /api/v1/ticks/latest — most recent realized tick through the CloudFront edge."
  value       = "https://${aws_cloudfront_distribution.market_edge.domain_name}/api/v1/ticks/latest"
}

output "portfolio_endpoint" {
  description = "GET /api/v1/portfolio through the CloudFront edge."
  value       = "https://${aws_cloudfront_distribution.market_edge.domain_name}/api/v1/portfolio"
}

output "trades_endpoint" {
  description = "POST /api/v1/trades through the CloudFront edge."
  value       = "https://${aws_cloudfront_distribution.market_edge.domain_name}/api/v1/trades"
}

output "trading_api_base_url" {
  description = "Base URL (CloudFront edge) the local server should use as TRADING_API_URL."
  value       = "https://${aws_cloudfront_distribution.market_edge.domain_name}"
}

output "dsql_cluster_identifier" {
  description = "Identifier of the Aurora DSQL cluster."
  value       = aws_dsql_cluster.market_db.identifier
}

output "dsql_cluster_arn" {
  description = "ARN of the Aurora DSQL cluster."
  value       = aws_dsql_cluster.market_db.arn
}

output "dsql_cluster_endpoint" {
  description = "Endpoint hostname of the Aurora DSQL cluster (<cluster-id>.dsql.<region>.on.aws)."
  value       = "${aws_dsql_cluster.market_db.identifier}.dsql.${var.aws_region}.on.aws"
}

output "ticks_generator_lambda_arn" {
  description = "ARN of the ticks-generator Lambda."
  value       = aws_lambda_function.ticks_generator.arn
}

output "ticks_fetcher_lambda_arn" {
  description = "ARN of the ticks-fetcher Lambda."
  value       = aws_lambda_function.ticks_fetcher.arn
}

output "trading_api_lambda_arn" {
  description = "ARN of the trading-api Lambda."
  value       = aws_lambda_function.trading_api.arn
}

output "hourly_sync_lambda_arn" {
  description = "ARN of the hourly-sync-engine Lambda."
  value       = aws_lambda_function.hourly_sync_engine.arn
}

output "ticks_generator_schedule_arn" {
  description = "ARN of the every-minute EventBridge schedule."
  value       = aws_cloudwatch_event_rule.ticks_generator_schedule.arn
}

output "hourly_sync_schedule_arn" {
  description = "ARN of the hourly EventBridge schedule."
  value       = aws_cloudwatch_event_rule.hourly_sync_schedule.arn
}
