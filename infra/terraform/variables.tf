variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

# ---------------------------------------------------------------------------
# Market configuration (deterministic series — mirrors server/src/trading/market.js)
# ---------------------------------------------------------------------------

variable "market_symbol" {
  description = "Ticker symbol stored in market_price_history."
  type        = string
  default     = "FAKE"
}

variable "market_base_price" {
  description = "Deterministic market start price."
  type        = number
  default     = 100
}

variable "market_volatility" {
  description = "Max per-step swing used by the deterministic walk."
  type        = number
  default     = 0.002
}

variable "market_start_epoch" {
  description = "Market series start epoch (seconds). August 24, 2026 00:00 UTC = 1787529600."
  type        = number
  default     = 1787529600
}

variable "market_seed" {
  description = "Deterministic PRNG seed (matches DEFAULT_PARAMS.seed in the app)."
  type        = number
  default     = 20260824
}

# ---------------------------------------------------------------------------
# Price store (DynamoDB)
# ---------------------------------------------------------------------------

variable "dynamodb_table_name" {
  description = "Name of the market_price_history table (composite key symbol + timestamp)."
  type        = string
  default     = "market_price_history"
}

variable "dynamodb_read_capacity" {
  description = "Provisioned read capacity units (1 RCU = $0 under the Always Free Tier)."
  type        = number
  default     = 1
}

variable "dynamodb_write_capacity" {
  description = "Provisioned write capacity units (1 WCU = $0 under the Always Free Tier)."
  type        = number
  default     = 1
}

variable "dynamodb_ttl_attribute" {
  description = "TTL attribute name. Items carry ttl = tick timestamp + 24h so data older than 24 hours is evicted for free."
  type        = string
  default     = "ttl"
}

# ---------------------------------------------------------------------------
# Cache edge layer (API Gateway + CloudFront)
# ---------------------------------------------------------------------------

variable "api_gateway_name" {
  description = "Name of the HTTP API Gateway."
  type        = string
  default     = "market-http-api"
}

variable "cloudfront_ticks_cache_ttl" {
  description = "Edge cache TTL (seconds) for GET /api/v1/ticks."
  type        = number
  default     = 14
}

# ---------------------------------------------------------------------------
# Relational ledger (Aurora DSQL)
# ---------------------------------------------------------------------------

variable "dsql_database" {
  description = "Database name to connect to inside the DSQL cluster."
  type        = string
  default     = "postgres"
}

variable "dsql_user" {
  description = "DSQL IAM db-connect user (admin role granted via generateDbConnectAdminAuthToken)."
  type        = string
  default     = "admin"
}

# ---------------------------------------------------------------------------
# Compute layer (Lambdas)
# ---------------------------------------------------------------------------

variable "lambda_memory_size" {
  description = "Lambda memory in MB (128 MB keeps every invocation inside the Always Free Tier)."
  type        = number
  default     = 128
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 30
}

variable "ticks_generator_function_name" {
  description = "Name of the ticks-generator Lambda."
  type        = string
  default     = "market-ticks-generator"
}

variable "ticks_generator_role_name" {
  description = "Name of the IAM role assumed by the ticks-generator Lambda."
  type        = string
  default     = "market-ticks-generator-role"
}

variable "ticks_generator_schedule_name" {
  description = "Name of the EventBridge schedule that wakes ticks-generator every minute."
  type        = string
  default     = "market-ticks-generator-schedule"
}

variable "ticks_fetcher_function_name" {
  description = "Name of the ticks-fetcher Lambda."
  type        = string
  default     = "market-ticks-fetcher"
}

variable "ticks_fetcher_role_name" {
  description = "Name of the IAM role assumed by the ticks-fetcher Lambda."
  type        = string
  default     = "market-ticks-fetcher-role"
}

variable "trading_api_function_name" {
  description = "Name of the trading-api Lambda."
  type        = string
  default     = "market-trading-api"
}

variable "trading_api_role_name" {
  description = "Name of the IAM role assumed by the trading-api Lambda."
  type        = string
  default     = "market-trading-api-role"
}

variable "hourly_sync_function_name" {
  description = "Name of the hourly-sync-engine Lambda."
  type        = string
  default     = "market-hourly-sync-engine"
}

variable "hourly_sync_role_name" {
  description = "Name of the IAM role assumed by the hourly-sync-engine Lambda."
  type        = string
  default     = "market-hourly-sync-engine-role"
}

variable "hourly_sync_schedule_name" {
  description = "Name of the EventBridge schedule that wakes hourly-sync-engine once per hour."
  type        = string
  default     = "market-hourly-sync-engine-schedule"
}

variable "account_start_cash" {
  description = "Starting cash balance for new trading accounts (used by trading-api)."
  type        = number
  default     = 10000
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default = {
    Project    = "fake-mcp-stock-trader"
    ManagedBy  = "terraform"
    CostCenter = "free-tier"
  }
}
