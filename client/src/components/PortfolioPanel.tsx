import { Stat, StatsGrid } from "ui";
import type { Account } from "../types";

export type PortfolioPanelProps = {
  account: Account;
};

export default function PortfolioPanel({ account }: PortfolioPanelProps) {
  return (
    <>
      <h2>Portfolio</h2>
      <StatsGrid>
        <Stat label="Cash" value={`$${account.cashAvailable.toFixed(2)}`} />
        <Stat label="Invested" value={`$${account.costBasis.toFixed(2)}`} />
        <Stat
          label="Gains/Losses"
          value={
            <span
              style={{
                color:
                  account.totalGainsLosses > 0
                    ? "#4caf79"
                    : account.totalGainsLosses < 0
                      ? "#ef6369"
                      : undefined,
              }}
            >
              {account.totalGainsLosses >= 0 ? "+" : "−"}$
              {Math.abs(account.totalGainsLosses).toFixed(2)}
            </span>
          }
        />
        <Stat label="Holdings" value={account.holdings} />
        <Stat
          label="Total Equity"
          value={`$${account.totalEquity.toFixed(2)}`}
        />
      </StatsGrid>
    </>
  );
}
