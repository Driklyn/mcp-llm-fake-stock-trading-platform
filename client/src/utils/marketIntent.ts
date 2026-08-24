export function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[$,]/g, "")
    .replace(/[^a-z0-9\s.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractNumber(text: string, fallback: number): number {
  const cleaned = normalizeText(text);
  const match = cleaned.match(/\b(\d+(?:\.\d+)?)\b/);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

export function extractAmount(text: string, fallback: number): number {
  const cleaned = normalizeText(text);
  const match = cleaned.match(
    /(?:\$?\s?(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:dollars?|usd)?)/,
  );
  const value = match ? Number(match[1] ?? match[2]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

export function extractOrderPrice(text: string, fallback: number): number {
  const cleaned = normalizeText(text);
  const match = cleaned.match(
    /(?:\$|at\s+|for\s+|limit\s+|stop\s+|above\s+|below\s+|under\s+|over\s+|@\s*)(\d+(?:\.\d+)?)/,
  );
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

export function detectIntent(text: string): string {
  const cleaned = normalizeText(text);

  if (
    /(portfolio|account|balance|equity|cash|holdings|invested|worth)/.test(
      cleaned,
    )
  ) {
    return "portfolio";
  }

  if (/(quote|price|market|ticker|current.*fa?k?e?)/.test(cleaned)) {
    return "quote";
  }

  if (
    /(limit|stop).*(buy|sell)|(buy|sell).*(limit|stop|at\s+\$|under|below|above|over)/.test(
      cleaned,
    )
  ) {
    return "place_order";
  }

  if (/(deposit|add cash|fund|transfer.*in|put in|top up)/.test(cleaned)) {
    return "deposit";
  }

  if (/(withdraw|remove cash|cash out|transfer.*out|take out)/.test(cleaned)) {
    return "withdraw";
  }

  if (/(sell|liquidate|exit|dump)/.test(cleaned)) {
    return "sell";
  }

  if (/(buy|purchase|acquire|own|grab)/.test(cleaned)) {
    return "buy";
  }

  if (/(orders?|pending)/.test(cleaned)) {
    return "orders";
  }

  if (/(cancel|remove|stop).*order|order.*(cancel|remove|stop)/.test(cleaned)) {
    return "cancel";
  }

  return "help";
}
