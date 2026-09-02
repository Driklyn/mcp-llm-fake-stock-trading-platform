import React, { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "./Table";
import {
  sortIndicator as sortIndicatorClass,
  sortableHeader,
} from "./table.css.ts";
import * as styles from "./transactionsHistory.css.ts";

export type TransactionStatus = "open" | "completed" | "cancelled" | "failed";

export type Transaction = {
  id: string;
  orderId?: string;
  kind: "buy" | "sell" | "deposit" | "withdrawal" | "limit" | "stop";
  side?: "buy" | "sell";
  quantity?: number;
  amount: number;
  price?: number;
  status: TransactionStatus;
  timestamp: number;
};

export type SortKey =
  | "status"
  | "time"
  | "type"
  | "side"
  | "quantity"
  | "price"
  | "amount";
export type SortDirection = "asc" | "desc";

export type TransactionsHistoryProps = {
  transactions?: Transaction[];
  title?: React.ReactNode;
  className?: string;
};

const TYPE_OPTIONS: Array<{ value: Transaction["kind"]; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
];

const STATUS_OPTIONS: Array<{
  value: TransactionStatus;
  label: string;
  className: string;
}> = [
  { value: "open", label: "Open/Pending", className: styles.statusOpen },
  { value: "completed", label: "Completed", className: styles.statusCompleted },
  { value: "cancelled", label: "Cancelled", className: styles.statusCancelled },
  { value: "failed", label: "Failed", className: styles.statusFailed },
];

const STATUS_LABELS: Record<TransactionStatus, string> = {
  open: "Open/Pending",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatAmount(value: number) {
  return `$${Number(value).toFixed(2)}`;
}

function formatPrice(value: number | undefined) {
  return value != null ? `$${Number(value).toFixed(2)}` : "—";
}

function formatQuantity(value: number | undefined) {
  return value != null ? String(Number(value)) : "—";
}

function statusClass(status: TransactionStatus) {
  switch (status) {
    case "open":
      return styles.statusOpen;
    case "completed":
      return styles.statusCompleted;
    case "cancelled":
      return styles.statusCancelled;
    case "failed":
      return styles.statusFailed;
    default:
      return styles.muted;
  }
}

function toggleValue<T>(value: T, set: Set<T>): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

// A "buy"/"sell" chip also matches entries whose `side` matches, so open
// limit/stop orders (kind "limit"/"stop" but side "buy"/"sell") show up.
function matchesType(
  entry: Transaction,
  types: Set<Transaction["kind"]>,
): boolean {
  return [...types].some((type) => entry.kind === type || entry.side === type);
}

function parsePriceInput(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

// Keep only digits and a single decimal point, max 2 decimal places.
function sanitizePriceInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (rest.length === 0) {
    return whole;
  }
  const decimals = rest.join("").slice(0, 2);
  return decimals ? `${whole}.${decimals}` : `${whole}.`;
}

export default function TransactionsHistory({
  transactions = [],
  title = "Transactions History",
  className,
}: TransactionsHistoryProps) {
  const [activeTypes, setActiveTypes] = useState<Set<Transaction["kind"]>>(
    new Set(),
  );
  const [activeStatuses, setActiveStatuses] = useState<Set<TransactionStatus>>(
    new Set(),
  );
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sortedTransactions = useMemo(() => {
    const min = parsePriceInput(minPrice);
    const max = parsePriceInput(maxPrice);

    const filtered = transactions.filter((entry) => {
      if (activeTypes.size > 0 && !matchesType(entry, activeTypes)) {
        return false;
      }
      if (activeStatuses.size > 0 && !activeStatuses.has(entry.status)) {
        return false;
      }
      const price = Number(entry.price);
      if (
        min != null &&
        (price == null || Number.isNaN(price) || price < min)
      ) {
        return false;
      }
      if (
        max != null &&
        (price == null || Number.isNaN(price) || price > max)
      ) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered];
    const direction = sortDirection === "asc" ? 1 : -1;

    const sortValue = (entry: Transaction): string | number | undefined => {
      switch (sortKey) {
        case "status":
          return entry.status;
        case "time":
          return entry.timestamp;
        case "type":
          return entry.kind;
        case "side":
          return entry.side;
        case "quantity":
          return entry.quantity;
        case "price":
          return entry.price;
        case "amount":
          return entry.amount;
      }
    };

    sorted.sort((a, b) => {
      const aValue = sortValue(a);
      const bValue = sortValue(b);

      // Missing values always sort last regardless of direction.
      if (aValue == null && bValue == null) {
        return 0;
      }
      if (aValue == null) {
        return 1;
      }
      if (bValue == null) {
        return -1;
      }

      let compare: number;
      if (typeof aValue === "number" && typeof bValue === "number") {
        compare = aValue - bValue;
      } else {
        compare = String(aValue).localeCompare(String(bValue));
      }

      return compare * direction;
    });

    return sorted;
  }, [
    transactions,
    activeTypes,
    activeStatuses,
    minPrice,
    maxPrice,
    sortKey,
    sortDirection,
  ]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  const handlePriceChange =
    (setter: React.Dispatch<React.SetStateAction<string>>) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const cleaned = sanitizePriceInput(raw);
      if (cleaned !== raw) {
        // Force the DOM back in sync when we truncated an extra decimal;
        // React bails out when the new state equals the old state, which
        // would otherwise leave the extra digit visible.
        event.target.value = cleaned;
      }
      setter(cleaned);
    };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) {
      return <span className={styles.muted}>↕</span>;
    }
    return (
      <span className={sortIndicatorClass}>
        {sortDirection === "asc" ? "▲" : "▼"}
      </span>
    );
  };

  return (
    <section className={`${styles.section}${className ? " " + className : ""}`}>
      <h3 className={styles.title}>{title}</h3>

      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Type:</span>
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.chip}${
                activeTypes.has(option.value) ? " " + styles.chipActive : ""
              }`}
              onClick={() =>
                setActiveTypes((current) => toggleValue(option.value, current))
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>State:</span>
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.chip}${
                activeStatuses.has(option.value) ? " " + styles.chipActive : ""
              }`}
              onClick={() =>
                setActiveStatuses((current) =>
                  toggleValue(option.value, current),
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className={styles.priceInputs}>
          <span className={styles.filterLabel}>Price:</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Min"
            value={minPrice}
            onChange={handlePriceChange(setMinPrice)}
            className={styles.priceInput}
          />
          <span className={styles.muted}>—</span>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="Max"
            value={maxPrice}
            onChange={handlePriceChange(setMaxPrice)}
            className={styles.priceInput}
          />
        </div>
      </div>

      <div className={styles.tableWrapper}>
        <Table className={styles.tableWrapper}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("time")}
              >
                Time {sortIndicator("time")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("type")}
              >
                Type {sortIndicator("type")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("side")}
              >
                Side {sortIndicator("side")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("quantity")}
              >
                Quantity {sortIndicator("quantity")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("price")}
              >
                Price {sortIndicator("price")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("amount")}
              >
                Amount {sortIndicator("amount")}
              </TableHeaderCell>
              <TableHeaderCell
                className={sortableHeader}
                onClick={() => handleSort("status")}
              >
                Status {sortIndicator("status")}
              </TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTransactions.length === 0 ? (
              <TableRow>
                <TableEmpty colSpan={7}>
                  No transactions match the current filters.
                </TableEmpty>
              </TableRow>
            ) : (
              sortedTransactions.map((entry, index) => {
                const isWithdrawal = entry.kind === "withdrawal";
                const isSell = entry.kind === "sell" || entry.side === "sell";
                const showNegative = isWithdrawal || isSell;
                const amountClass = showNegative
                  ? styles.negative
                  : styles.positive;
                const rowKey = `${entry.id ?? "row"}-${entry.kind}-${entry.timestamp}-${index}`;

                return (
                  <TableRow key={rowKey}>
                    <TableCell>{formatTime(entry.timestamp)}</TableCell>
                    <TableCell>{entry.kind}</TableCell>
                    <TableCell>{entry.side ?? "—"}</TableCell>
                    <TableCell>{formatQuantity(entry.quantity)}</TableCell>
                    <TableCell>{formatPrice(entry.price)}</TableCell>
                    <TableCell className={amountClass}>
                      {formatAmount(entry.amount)}
                    </TableCell>
                    <TableCell className={statusClass(entry.status)}>
                      {STATUS_LABELS[entry.status] ?? entry.status}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
