function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[$,]/g, "")
    .replace(/[^a-z0-9\s.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumber(text, fallback = 1) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(/\b(\d+(?:\.\d+)?)\b/);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function extractAmount(text, fallback = 0) {
  const raw = String(text ?? "");
  const hasCurrency = /\$|\bdollars?\b|\busd\b/i.test(raw);
  if (!hasCurrency) return fallback;
  const cleaned = raw.replace(/[$,]/g, "").replace(/[^0-9.]/g, " ");
  const match = cleaned.match(/(\d+(?:\.\d+)?)/);
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function extractPrice(text, fallback = 0) {
  const cleaned = normalizeText(text);
  const match = cleaned.match(
    /(?:\$|at\s+|for\s+|limit\s+|stop\s+|above\s+|below\s+|under\s+|over\s+|@\s*)(\d+(?:\.\d+)?)/,
  );
  const value = match ? Number(match[1]) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function extractConditionalQuantity(text) {
  const cleaned = normalizeText(text);
  const sharesMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*shares?/);
  if (sharesMatch) {
    return Number(sharesMatch[1]);
  }
  // Strip the trigger price so it can never be mistaken for a quantity,
  // then look for a number in the segment before the trigger phrase
  // (e.g. "buy 3 when the price rises above $90").
  const withoutPrice = cleaned.replace(
    /(?:\$|at|for|limit|stop|above|below|under|over|@)\s*\d+(?:\.\d+)?/g,
    "",
  );
  const segment = withoutPrice.split(
    /\b(when|if|once|as soon as|above|over|below|under)\b/,
  )[0];
  const numberMatch = segment.match(/\b(\d+(?:\.\d+)?)\b/);
  return numberMatch ? Number(numberMatch[1]) : null;
}

export function normalizeTradeQuantity(rawQuantity) {
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return null;
  }
  return quantity;
}

const VALID_TOOLS = new Set([
  "get_account_snapshot",
  "get_quote",
  "buy_stock",
  "sell_stock",
  "transfer_cash",
  "place_order",
  "list_orders",
  "cancel_order",
]);

export function requiresConfirmationForTrade(quantity, pricePerShare) {
  const qty = Number(quantity);
  const price = Number(pricePerShare);
  if (!Number.isFinite(qty) || qty <= 0) {
    return false;
  }

  if (!Number.isFinite(price) || price <= 0) {
    return false;
  }

  return qty * price >= 1000;
}

export function parseToolPlan(
  rawPlan,
  fallbackPrompt,
  pendingTool = undefined,
) {
  const fallback = buildTradePlan(fallbackPrompt, {
    allowNetwork: false,
    pendingTool,
  });
  if (!rawPlan || typeof rawPlan !== "string") {
    return fallback;
  }

  let candidate = rawPlan.trim();
  if (candidate.startsWith("```")) {
    candidate = candidate
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  }

  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidate = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(candidate);
    const tool = parsed?.tool;
    const normalizedTool =
      typeof tool === "string" ? tool.trim().toLowerCase() : "";

    if (typeof tool === "string" && VALID_TOOLS.has(normalizedTool)) {
      const argumentsValue =
        parsed?.arguments && typeof parsed.arguments === "object"
          ? parsed.arguments
          : {};
      return {
        tool: normalizedTool,
        arguments: argumentsValue,
      };
    }

    if (["none", "null", "n/a", "not applicable"].includes(normalizedTool)) {
      return {
        tool: null,
        arguments: {},
        fallback:
          "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, placing limit or stop orders, depositing or withdrawing cash, and listing or canceling orders.",
      };
    }
  } catch {
    // fall through to the deterministic planner below
  }

  return fallback;
}

export function buildTradePlan(prompt, options = {}) {
  const allowNetwork = options.allowNetwork !== false;
  const livePrice = Number(options.pricePerShare ?? 100);
  const text = normalizeText(prompt);
  const pendingTool = options.pendingTool;
  const wantsConfirmation =
    /(^|\s)(confirm|confirmed|accepted|accept|yes|proceed|go ahead|execute|approve|approved)(\s|$)/.test(
      text,
    );

  if (pendingTool && wantsConfirmation) {
    return {
      tool: pendingTool.tool,
      arguments: {
        ...(pendingTool.arguments ?? {}),
        confirm: true,
      },
    };
  }

  if (
    !/(portfolio|account|balance|equity|cash|holdings|invested|worth|quote|price|market|ticker|fake|buy|purchase|acquire|own|grab|sell|liquidate|exit|dump|deposit|add cash|fund|transfer.*in|put in|top up|withdraw|remove cash|cash out|transfer.*out|take out|limit|stop|orders?|pending|cancel|remove)/.test(
      text,
    )
  ) {
    return {
      tool: null,
      arguments: {},
      fallback:
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, placing limit or stop orders, depositing or withdrawing cash, and listing or canceling orders.",
    };
  }

  const hasLimit = /limit/.test(text);
  const hasStop = /stop/.test(text);
  const hasBuyIntent = /(buy|purchase|acquire|own|grab)/.test(text);
  const hasSellIntent = /(sell|liquidate|exit|dump)/.test(text);
  const hasAbove =
    /(above|over|higher\s+than|greater\s+than|rises?\s+to|climbs?\s+to|goes?\s+up\s+to|reach(?:es)?\s+)/.test(
      text,
    );
  const hasBelow =
    /(below|under|lower\s+than|less\s+than|drops?\s+to|falls?\s+to|declines?\s+to|goes?\s+down\s+to)/.test(
      text,
    );
  const hasTriggerWord = hasAbove || hasBelow;
  const hasTradeIntent = hasBuyIntent || hasSellIntent;

  if (
    /(portfolio|account|balance|equity|cash|holdings|invested|worth)/.test(text)
  ) {
    return { tool: "get_account_snapshot", arguments: {} };
  }

  if (
    /(quote|price|market|ticker|current.*fake)/.test(text) &&
    !hasTradeIntent
  ) {
    return { tool: "get_quote", arguments: {} };
  }

  const wantsOrderList =
    /(check|list|show|view|see|display).*(orders?|buys?|sells?)/.test(text) ||
    /\bmy\b.*\b(orders?|buys?|sells?)\b/.test(text) ||
    /\b(open|pending|active)\s+(limit\s+|stop\s+)?(buy\s+|sell\s+)?(orders?|buys?|sells?)\b/.test(
      text,
    ) ||
    /(what|which)\s+(limit\s+|stop\s+)?(buy\s+|sell\s+)?orders?\b/.test(text) ||
    /(do|have)\s+i\s+(have\s+)?(any\s+)?(orders?|buys?|sells?)/.test(text);

  if (wantsOrderList) {
    const argumentsValue = {};
    if (hasStop) argumentsValue.type = "stop";
    else if (hasLimit) argumentsValue.type = "limit";
    if (hasSellIntent && !hasBuyIntent) argumentsValue.side = "sell";
    else if (hasBuyIntent && !hasSellIntent) argumentsValue.side = "buy";
    return { tool: "list_orders", arguments: argumentsValue };
  }

  if (
    (hasLimit || hasStop || hasTriggerWord) &&
    (hasBuyIntent || hasSellIntent) &&
    !/order.*(cancel|remove)|(cancel|remove).*order/.test(text)
  ) {
    const buyIntentOnly = hasBuyIntent && !hasSellIntent;
    const sellIntentOnly = hasSellIntent && !hasBuyIntent;
    const side = sellIntentOnly ? "sell" : "buy";
    let type = hasStop ? "stop" : "limit";

    if (!hasLimit && !hasStop && hasTriggerWord) {
      // Map direction words to the matching conditional order semantics:
      // buy + above -> stop buy, buy + below -> limit buy,
      // sell + above -> limit sell, sell + below -> stop sell.
      if (hasAbove) type = buyIntentOnly ? "stop" : "limit";
      else type = buyIntentOnly ? "limit" : "stop";
    }

    const triggerPrice = extractPrice(prompt, livePrice);
    const quantity = extractConditionalQuantity(text);

    if (!quantity || !Number.isFinite(quantity)) {
      return {
        tool: null,
        arguments: {},
        fallback: `How many shares would you like to ${side}? For a ${type} ${side} order at $${triggerPrice.toFixed(2)}, say something like "${side} 2 shares when the price is ${hasAbove ? "above" : "below"} $${triggerPrice.toFixed(2)}".`,
      };
    }

    const confirmationRequired = requiresConfirmationForTrade(
      quantity,
      livePrice,
    );
    const argumentsValue = {
      type,
      side,
      quantity,
      price: triggerPrice,
    };

    if (confirmationRequired) {
      argumentsValue.confirm = !!wantsConfirmation;
    }

    return {
      tool: "place_order",
      arguments: argumentsValue,
    };
  }

  if (/(deposit|add cash|fund|transfer.*in|put in|top up)/.test(text)) {
    return {
      tool: "transfer_cash",
      arguments: { amount: Math.max(0, extractAmount(prompt, 0)) },
    };
  }

  if (/(withdraw|remove cash|cash out|transfer.*out|take out)/.test(text)) {
    return {
      tool: "transfer_cash",
      arguments: {
        amount: -Math.max(0, extractAmount(prompt, 0)),
      },
    };
  }

  if (hasSellIntent && !hasLimit && !hasStop) {
    const amount = extractAmount(prompt, 0);
    let quantity = Math.max(1, extractNumber(text, 1));
    if (amount > 0) {
      const computed = Math.floor(amount / livePrice);
      if (computed <= 0) {
        return {
          tool: null,
          arguments: {},
          fallback: `At the current price of $${livePrice.toFixed(2)}, $${amount.toFixed(2)} would sell 0 whole shares. Increase the amount or specify a quantity to proceed.`,
        };
      }
      quantity = Math.max(1, computed);
    }
    const confirmationRequired = requiresConfirmationForTrade(
      quantity,
      livePrice,
    );
    const argumentsValue = { quantity };
    if (amount > 0) argumentsValue.amount = amount;

    if (confirmationRequired) {
      argumentsValue.confirm = !!wantsConfirmation;
    }

    return {
      tool: "sell_stock",
      arguments: argumentsValue,
    };
  }

  if (hasBuyIntent && !hasLimit && !hasStop) {
    const amount = extractAmount(prompt, 0);
    let quantity = Math.max(1, extractNumber(text, 1));
    if (amount > 0) {
      const computed = Math.floor(amount / livePrice);
      if (computed <= 0) {
        return {
          tool: null,
          arguments: {},
          fallback: `At the current price of $${livePrice.toFixed(2)}, $${amount.toFixed(2)} would buy 0 whole shares. Increase the amount or say 'buy 1 share' to proceed.`,
        };
      }
      quantity = Math.max(1, computed);
    }
    const confirmationRequired = requiresConfirmationForTrade(
      quantity,
      livePrice,
    );
    const argumentsValue = { quantity };
    if (amount > 0) argumentsValue.amount = amount;

    if (confirmationRequired) {
      argumentsValue.confirm = !!wantsConfirmation;
    }

    return {
      tool: "buy_stock",
      arguments: argumentsValue,
    };
  }

  if (/(cancel|remove).*order|order.*(cancel|remove)/.test(text)) {
    return { tool: "cancel_order", arguments: { orderId: "pending" } };
  }

  if (/(orders?|pending)/.test(text)) {
    return { tool: "list_orders", arguments: {} };
  }

  if (!allowNetwork) {
    return {
      tool: "get_account_snapshot",
      arguments: {},
      fallback:
        "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
    };
  }

  return {
    tool: "get_account_snapshot",
    arguments: {},
    fallback:
      "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
  };
}

export async function getAssistantResponse(prompt, dependencies = {}) {
  const {
    model = "llama3.1:8b",
    fetchFn = globalThis.fetch,
    baseUrl = "http://localhost:11434/api",
    chatPath = "/chat",
    apiKey,
    pricePerShare = 100,
  } = dependencies;

  const plan = buildTradePlan(prompt, {
    allowNetwork: true,
    pricePerShare,
    pendingTool: dependencies.pendingTool,
  });

  if (plan.tool === null || !fetchFn) {
    return {
      plan,
      text:
        plan.fallback ??
        "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, placing limit or stop orders, depositing or withdrawing cash, and listing or canceling orders.",
    };
  }

  try {
    const toolList = [...VALID_TOOLS].join(", ");

    const response = await fetchFn(`${baseUrl.replace(/\/$/, "")}${chatPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "system",
            content: `You are a trading assistant for a fake stock app. Return valid JSON only. If the user request is not clearly about portfolio, price, buying, selling, limit or stop orders, transfers, or order cancellation, return {"tool":"none","arguments":{}}. Otherwise choose exactly one tool from this list: ${toolList}. When the user asks to check, list, show, view, or see their orders (for example 'check limit orders' or 'my pending orders'), use list_orders and never place_order. For place_order, arguments must include type ('limit' or 'stop'), side ('buy' or 'sell'), quantity, and price. Return {"tool":"TOOL_NAME","arguments":{...}}. Keep values numeric when required. Be concise and precise.`,
          },
          { role: "user", content: prompt },
        ],
        // Ollama nests sampling options under `options`; OpenAI-compatible
        // endpoints (e.g. OpenRouter) take `temperature` at the top level.
        ...(apiKey
          ? { temperature: 0.1 }
          : { options: { temperature: 0.1 } }),
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM responded with ${response.status}`);
    }

    const data = await response.json();
    const rawContent =
      data.message?.content ?? data.choices?.[0]?.message?.content ?? "";

    const parsedPlan = parseToolPlan(
      String(rawContent),
      prompt,
      dependencies.pendingTool,
    );

    const normalizedText = normalizeText(prompt);
    const textHasBuyIntent = /(buy|purchase|acquire|own|grab)/.test(
      normalizedText,
    );
    const textHasSellIntent = /(sell|liquidate|exit|dump)/.test(
      normalizedText,
    );
    const textHasTriggerWord =
      /(above|over|higher than|below|under|lower than|rises?\s+to|drops?\s+to|falls?\s+to|climbs?\s+to)/.test(
        normalizedText,
      );

    const parsedTool = parsedPlan?.tool;
    const parsedSide =
      parsedTool === "buy_stock"
        ? "buy"
        : parsedTool === "sell_stock"
          ? "sell"
          : typeof parsedPlan?.arguments?.side === "string"
            ? parsedPlan.arguments.side.toLowerCase()
            : null;

    const llmFlipsSide =
      (textHasBuyIntent &&
        !textHasSellIntent &&
        parsedSide != null &&
        parsedSide !== "buy") ||
      (textHasSellIntent &&
        !textHasBuyIntent &&
        parsedSide != null &&
        parsedSide !== "sell");

    const llmTurnsConditionalIntoMarket =
      textHasTriggerWord &&
      (textHasBuyIntent || textHasSellIntent) &&
      plan.tool === "place_order" &&
      (parsedTool === "buy_stock" || parsedTool === "sell_stock");

    const llmTurnsMarketIntoConditional =
      !textHasTriggerWord &&
      (textHasBuyIntent || textHasSellIntent) &&
      (plan.tool === "buy_stock" || plan.tool === "sell_stock") &&
      parsedTool === "place_order";

    // Listing open orders is read-only, a buy must never become a sell (or
    // vice versa), an explicitly conditional order must never degrade into
    // an immediate market trade, and a plain market trade must never be turned
    // into a conditional order. Prefer the deterministic plan in all of those
    // cases so a hallucinated LLM plan can't execute something contradictory.
    // Similarly, if the LLM responds with no tool at all but the deterministic
    // plan recognized a clear trading intent (for example "buy share" should
    // buy 1 share), the deterministic plan wins instead of the generic help.
    const finalPlan =
      plan.tool === "list_orders" ||
      llmFlipsSide ||
      llmTurnsConditionalIntoMarket ||
      llmTurnsMarketIntoConditional ||
      (parsedPlan.tool === null && plan.tool !== null)
        ? plan
        : parsedPlan;
    const content =
      finalPlan.tool === null
        ? (finalPlan.fallback ??
          "I can help with trading tasks like checking your portfolio, getting the FAKE price, buying or selling shares, placing limit or stop orders, depositing or withdrawing cash, and listing or canceling orders.")
        : finalPlan.tool === "list_orders"
          ? "Here are your current open orders."
          : typeof rawContent === "string" && rawContent.trim()
            ? rawContent.trim()
            : plan.fallback;

    return {
      plan: finalPlan,
      text: content,
    };
  } catch (error) {
    const fallbackPlan = buildTradePlan(prompt, {
      allowNetwork: false,
      pricePerShare,
    });
    return {
      plan: fallbackPlan,
      text:
        fallbackPlan.fallback ??
        "I can help with portfolio checks, price quotes, buys, sells, limit and stop orders, deposits, withdrawals, and order cancellations.",
    };
  }
}





