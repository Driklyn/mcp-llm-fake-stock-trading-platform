/**
 * DynamoDB-backed pending-confirmation store (production Lambda).
 *
 * Items are keyed by confirmationId (S) and carry an epoch-seconds `ttl` set to
 * `createdAt + ttlSeconds`, so DynamoDB TTL evicts unconsumed confirmations at
 * zero cost. TTL garbage collection can lag for up to ~48h, so reads
 * defensively treat expired items as missing.
 */

import { randomUUID } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";

export const DEFAULT_TTL_SECONDS = 7200;

function toItem(entry, confirmationId, createdAtSeconds, ttlSeconds) {
  return {
    confirmationId: { S: confirmationId },
    tool: { S: String(entry.tool ?? "") },
    arguments: { S: JSON.stringify(entry.arguments ?? {}) },
    createdAt: { N: String(createdAtSeconds) },
    ttl: { N: String(createdAtSeconds + ttlSeconds) },
  };
}

function fromItem(item) {
  if (!item) return null;
  let argumentsValue = {};
  try {
    argumentsValue = JSON.parse(item.arguments?.S ?? "{}");
  } catch {
    argumentsValue = {};
  }
  return {
    confirmationId: item.confirmationId?.S,
    tool: item.tool?.S,
    arguments: argumentsValue,
    createdAt: Number(item.createdAt?.N ?? 0),
    ttl: Number(item.ttl?.N ?? 0),
  };
}

export function createDynamoPendingStore({
  tableName = process.env.PENDING_CONFIRMATIONS_TABLE,
  ttlSeconds = Number(
    process.env.PENDING_CONFIRMATIONS_TTL_SECONDS ?? DEFAULT_TTL_SECONDS,
  ),
  client = new DynamoDBClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  }),
  now = () => Date.now(),
} = {}) {
  const nowSeconds = () => Math.floor(now() / 1000);

  const isExpired = (item) =>
    !item || (Number(item.ttl ?? 0) > 0 && Number(item.ttl) <= nowSeconds());

  return {
    async put(entry) {
      const confirmationId = randomUUID();
      const createdAt = nowSeconds();
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: toItem(entry, confirmationId, createdAt, ttlSeconds),
        }),
      );
      return {
        ...entry,
        confirmationId,
        createdAt,
        ttl: createdAt + ttlSeconds,
      };
    },
    async get(confirmationId) {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { confirmationId: { S: String(confirmationId) } },
        }),
      );
      const item = fromItem(Item);
      return isExpired(item) ? null : item;
    },
    async remove(confirmationId) {
      await client.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { confirmationId: { S: String(confirmationId) } },
        }),
      );
    },
    async size() {
      const { Items = [] } = await client.send(
        new ScanCommand({ TableName: tableName }),
      );
      return Items.filter((item) => !isExpired(fromItem(item))).length;
    },
    async clear() {
      const { Items = [] } = await client.send(
        new ScanCommand({ TableName: tableName }),
      );
      for (const item of Items) {
        await client.send(
          new DeleteItemCommand({
            TableName: tableName,
            Key: { confirmationId: { S: item.confirmationId.S } },
          }),
        );
      }
    },
  };
}
