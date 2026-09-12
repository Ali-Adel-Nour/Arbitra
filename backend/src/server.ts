import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  evaluateDeal,
  judgeDeliverable,
} from "./ai-judge/index.js";
import { settleEscrow } from "./oracle.js";
import { getReputation, getMcpActivity } from "./reputation.js";
import { markDealResolved, persistPreimage, readAllPersistedDeals } from "./persistence.js";
import { readPersistedJudgment } from "./persistence.js";
import { verifyVerdictHash, hashCanonicalValue } from "./ai-judge/verdict.js";
import { startResilientOracle } from "./blockchain/eventListener.js";
import { escrowContract } from "./blockchain/contractClient.js";

export const settlementGateway = { settleEscrow };

const PORT = Number(process.env.PORT ?? 3000);

// Cache on-chain deal info to prevent RPC rate limits when frontend polls /api/deals
const onChainDealCache = new Map<string, { amount: string; token: string }>();

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Arbitra-Internal-Key"
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  setCorsHeaders(response);

  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });

  response.end(JSON.stringify(payload));
}

async function readJsonBody(
  request: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf-8");

  if (!body.trim()) {
    throw new Error("Request body is empty");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function validateJudgeInput(
  body: unknown
): body is {
  task: string;
  acceptanceCriteria: string[];
  deliverable: string;
} {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const input = body as Record<string, unknown>;

  return (
    typeof input.task === "string" &&
    Array.isArray(input.acceptanceCriteria) &&
    input.acceptanceCriteria.every(
      (item) => typeof item === "string"
    ) &&
    typeof input.deliverable === "string"
  );
}

function isBadRequestError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "Request body is empty" ||
      error.message === "Request body must be valid JSON")
  );
}

interface ApiJudgeInput {
  dealId: string;
  acceptanceCriteria: string[];
  deliverable: string;
  deadline: string | number;
  buyer?: string;
  seller?: string;
  taskCategory?: string;
}

function parseDeadline(value: unknown): string | number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : value;
}

function validateApiJudgeInput(
  body: unknown
): body is ApiJudgeInput {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const input = body as Record<string, unknown>;
  const deadline = parseDeadline(input.deadline);

  if (deadline === undefined) {
    return false;
  }

  return (
    typeof input.dealId === "string" &&
    input.dealId.trim().length > 0 &&
    Array.isArray(input.acceptanceCriteria) &&
    input.acceptanceCriteria.length > 0 &&
    input.acceptanceCriteria.every(
      (item) => typeof item === "string" && item.trim().length > 0
    ) &&
    typeof input.deliverable === "string" &&
    input.deliverable.trim().length > 0 &&
    (input.buyer === undefined || typeof input.buyer === "string") &&
    (input.seller === undefined || typeof input.seller === "string") &&
    (input.taskCategory === undefined || typeof input.taskCategory === "string") &&
    (typeof deadline === "number" || typeof deadline === "string") &&
    new Date(
      typeof deadline === "number" ? deadline * 1000 : deadline
    ).getTime() > Date.now()
  );
}

function validateSettlementInput(
  body: unknown
): body is {
  dealId: string;
  task: string;
  acceptanceCriteria: string[];
  deliverable: string;
} {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const input = body as Record<string, unknown>;

  return (
    typeof input.dealId === "string" &&
    validateJudgeInput({
      task: input.task,
      acceptanceCriteria: input.acceptanceCriteria,
      deliverable: input.deliverable,
    })
  );
}

function isAuthorizedSettlementRequest(
  request: IncomingMessage
): boolean {
  const expectedKey = process.env.ARBITRA_INTERNAL_KEY;
  const providedKey = request.headers["x-arbitra-internal-key"];

  if (!expectedKey || typeof providedKey !== "string") {
    return false;
  }

  return providedKey === expectedKey;
}

export const server = createServer(
  async (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    setCorsHeaders(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: "arbitra-ai-judge",
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/judge") {
      try {
        const body = await readJsonBody(request);

        if (!validateApiJudgeInput(body)) {
          sendJson(response, 400, {
            success: false,
            error:
              "Invalid input. Expected dealId, acceptanceCriteria[], deliverable, and deadline.",
          });
          return;
        }

        sendJson(response, 200, await evaluateDeal(body));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown server error";

        sendJson(response, isBadRequestError(error) ? 400 : 502, {
          success: false,
          error: `AI Judge request failed: ${message}`,
        });
      }

      return;
    }

    if (request.method === "GET" && request.url === "/api/deals") {
      try {
        const persistedDeals = await readAllPersistedDeals();
        
        const validDealsPromises = [];
        const seenIds = new Set<string>();
        for (const d of persistedDeals) {
          const dealId = d.dealId.trim();
          // The frontend requires dealId to be exactly a non-zero 32-byte hex.
          if (!/^0x[0-9a-fA-F]{64}$/.test(dealId) || /^0x0{64}$/.test(dealId)) {
            continue; // Skip mock slugs like "deal-fail" or invalid formats
          }
          // Deduplicate by trimmed dealId (prevents React duplicate-key errors)
          if (seenIds.has(dealId)) continue;
          seenIds.add(dealId);

          let state = d.state || "Created";
          if (state === "JUDGED") state = "Submitted";
          if (state === "RESOLVED") {
            state = d.aiVerdict ? "ResolvedSuccess" : "ResolvedRefund";
          }

          let verdictReasoningHash = null;
          if (d.resolvedTxHash && /^0x[0-9a-fA-F]{64}$/.test(d.resolvedTxHash)) {
            verdictReasoningHash = d.resolvedTxHash;
          }

          const isValidAddress = (val: string) => /^0x[0-9a-fA-F]{40}$/.test(val);
          const buyer = (d.buyerAddress && isValidAddress(d.buyerAddress)) 
            ? d.buyerAddress 
            : "0x0000000000000000000000000000000000000000";
          const seller = (d.sellerAddress && isValidAddress(d.sellerAddress)) 
            ? d.sellerAddress 
            : "0x0000000000000000000000000000000000000000";

          // judgeRequestedAt means "in flight NOW", not "was requested once".
          // Only set it when the deal is awaiting a verdict that hasn't arrived
          // yet. A JUDGED deal with aiVerdict already set has finished
          // deliberating — the oracle just hasn't settled it on-chain yet.
          const judgeInFlight =
            d.state === "JUDGED" && d.aiVerdict === null && state === "Submitted";

          validDealsPromises.push(async () => {
            let amount = "10000000"; // Fallback 10 USDC
            let token = "0x3600000000000000000000000000000000000000";
            
            // Skip dummy/mock deal IDs to prevent unnecessary RPC calls
            if (!dealId.startsWith("0x9999999990123456")) {
              // Read from cache first to avoid RPC rate limits
              if (onChainDealCache.has(dealId)) {
                const cached = onChainDealCache.get(dealId)!;
                amount = cached.amount;
                token = cached.token;
              } else {
                try {
                  const onChainDeal = await escrowContract.escrows(dealId);
                  if (onChainDeal && onChainDeal.amount !== undefined && onChainDeal.amount > 0n) {
                    amount = onChainDeal.amount.toString();
                    token = onChainDeal.token;
                    // Cache successful results indefinitely (amounts don't change)
                    onChainDealCache.set(dealId, { amount, token });
                  } else {
                    // Cache the fallback to prevent retrying a missing contract every 4s
                    onChainDealCache.set(dealId, { amount, token });
                  }
                } catch (err: any) {
                  const reason = err.code || (err instanceof Error ? err.message : "Unknown error");
                  // Only log if it's an unexpected error, not just a missing contract (CALL_EXCEPTION)
                  if (reason !== "CALL_EXCEPTION") {
                    console.warn(`Failed to fetch on-chain amount for deal: ${dealId} (${reason})`);
                  }
                  // Cache the fallback on failure to avoid spamming the failing RPC
                  onChainDealCache.set(dealId, { amount, token });
                }
              }
            }

            return {
              dealId,
              buyer,
              seller,
              token,
              amount,
              criteriaHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
              deadline: d.deadline ? d.deadline.toISOString() : new Date().toISOString(),
              state,
              deliverableHash: null,
              verdictReasoningHash,
              ...(judgeInFlight ? { judgeRequestedAt: d.createdAt.toISOString() } : {})
            };
          });
        }
        
        // Execute promises in chunks of 5 to avoid RPC rate limits
        const validDeals = [];
        for (let i = 0; i < validDealsPromises.length; i += 5) {
          const chunk = validDealsPromises.slice(i, i + 5);
          const results = await Promise.all(chunk.map((fn) => fn()));
          validDeals.push(...results);
        }

        sendJson(response, 200, {
          deals: validDeals,
          asOf: new Date().toISOString()
        });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Unable to read deals",
        });
      }
      return;
    }

    if (request.method === "GET" && request.url === "/api/agents") {
      try {
        const persistedDeals = await readAllPersistedDeals();
        const sellers = new Map<string, { totalJudged: number; categories: Set<string> }>();
        for (const d of persistedDeals) {
          if (!d.sellerAddress || !/^0x[0-9a-fA-F]{40}$/.test(d.sellerAddress) || d.aiVerdict === null) continue;
          const seller = d.sellerAddress;
          if (!sellers.has(seller)) {
            sellers.set(seller, { totalJudged: 0, categories: new Set() });
          }
          const s = sellers.get(seller)!;
          s.totalJudged++;
          if (d.taskCategory) s.categories.add(d.taskCategory);
        }
        
        const agents = Array.from(sellers.entries()).map(([agent, data]) => ({
          agent,
          address: agent,
          totalJudged: data.totalJudged,
          taskCategories: Array.from(data.categories),
        }));
        
        sendJson(response, 200, { agents, asOf: new Date().toISOString() });
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to read agents" });
      }
      return;
    }

    if (request.method === "GET" && request.url === "/api/mcp-activity") {
      sendJson(response, 200, { entries: getMcpActivity(), asOf: new Date().toISOString() });
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/reputation/")) {
      let agent: string;
      try {
        const path = new URL(request.url, "http://localhost").pathname;
        agent = decodeURIComponent(path.slice("/api/reputation/".length));
      } catch {
        sendJson(response, 400, { error: "Agent must be URL encoded" });
        return;
      }

      if (!agent.trim()) {
        sendJson(response, 400, { error: "Agent is required" });
        return;
      }
      try {
        sendJson(response, 200, await getReputation(agent));
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : "Unable to read reputation" });
      }
      return;
    }

    if (request.method === "POST" && request.url === "/api/preimage") {
      try {
        const body = await readJsonBody(request);
        if (typeof body !== "object" || body === null) {
          sendJson(response, 400, { error: "Invalid body" });
          return;
        }
        
        const { dealId, criteria, deliverable } = body as Record<string, any>;
        if (typeof dealId !== "string" || !dealId.trim()) {
          sendJson(response, 400, { error: "dealId is required" });
          return;
        }

        let parsedCriteria: string[] | undefined;
        if (typeof criteria === "string") {
          try {
            parsedCriteria = JSON.parse(criteria);
            if (!Array.isArray(parsedCriteria)) parsedCriteria = undefined;
          } catch {
            parsedCriteria = undefined;
          }
        } else if (Array.isArray(criteria)) {
          parsedCriteria = criteria;
        }

        await persistPreimage(dealId, parsedCriteria, typeof deliverable === "string" ? deliverable : undefined);
        sendJson(response, 200, { success: true });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Unable to persist preimage",
        });
      }
      return;
    }

    if (request.method === "GET" && request.url?.startsWith("/api/verify/")) {
      let dealId: string;
      try {
        const path = new URL(request.url, "http://localhost").pathname;
        dealId = decodeURIComponent(path.slice("/api/verify/".length));
      } catch {
        sendJson(response, 400, { error: "Deal ID must be URL encoded" });
        return;
      }

      if (!dealId.trim()) {
        sendJson(response, 400, { error: "Deal ID is required" });
        return;
      }

      try {
        const record = await readPersistedJudgment(dealId);
        if (!record) {
          sendJson(response, 404, { error: "Judgment not found" });
          return;
        }
        sendJson(response, 200, { ...record, verified: verifyVerdictHash(record) });
      } catch (error) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : "Unable to read judgment",
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/api/judge-and-settle"
    ) {
      if (!process.env.ARBITRA_INTERNAL_KEY) {
        sendJson(response, 503, {
          success: false,
          error: "Settlement endpoint is not configured",
        });
        return;
      }

      if (!isAuthorizedSettlementRequest(request)) {
        sendJson(response, 401, {
          success: false,
          error: "Unauthorized settlement request",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);

        if (!validateApiJudgeInput(body)) {
          sendJson(response, 400, {
            success: false,
            error:
              "Invalid input. Expected dealId, acceptanceCriteria[], deliverable, and a future deadline.",
          });
          return;
        }

        const verdict = await evaluateDeal(body);
        const settlement = await settlementGateway.settleEscrow(
          body.dealId,
          verdict.approved,
          verdict.reasoning,
          verdict.verdictHash
        );
        await markDealResolved(body.dealId, settlement.transactionHash);

        sendJson(response, 200, { verdict, settlement });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown server error";

        sendJson(response, isBadRequestError(error) ? 400 : 502, {
          success: false,
          error: `AI Judge settlement failed: ${message}`,
        });
      }

      return;
    }

    if (request.method === "POST" && request.url === "/judge") {
      try {
        const body = await readJsonBody(request);

        if (!validateJudgeInput(body)) {
          sendJson(response, 400, {
            success: false,
            error:
              "Invalid input. Expected task, acceptanceCriteria[], and deliverable.",
          });
          return;
        }

        const result = await judgeDeliverable({
          task: body.task,
          acceptanceCriteria: body.acceptanceCriteria,
          deliverable: body.deliverable,
        });

        sendJson(response, 200, {
          success: true,
          result,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown server error";

        sendJson(response, 500, {
          success: false,
          error: message,
        });
      }

      return;
    }

    if (
      request.method === "POST" &&
      request.url === "/judge-and-settle"
    ) {
      if (!process.env.ARBITRA_INTERNAL_KEY) {
        sendJson(response, 503, {
          success: false,
          error: "Settlement endpoint is not configured",
        });
        return;
      }

      if (!isAuthorizedSettlementRequest(request)) {
        sendJson(response, 401, {
          success: false,
          error: "Unauthorized settlement request",
        });
        return;
      }

      try {
        const body = await readJsonBody(request);

        if (!validateSettlementInput(body)) {
          sendJson(response, 400, {
            success: false,
            error:
              "Invalid input. Expected dealId, task, acceptanceCriteria[], and deliverable.",
          });
          return;
        }

        const result = await judgeDeliverable({
          task: body.task,
          acceptanceCriteria: body.acceptanceCriteria,
          deliverable: body.deliverable,
        });

        const settlement = await settleEscrow(
          body.dealId,
          result.approved,
          result.reasoning
        );

        sendJson(response, 200, {
          success: true,
          result,
          settlement,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown server error";

        sendJson(response, 500, {
          success: false,
          error: message,
        });
      }

      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/judgments/")) {
      let dealId: string;
      try {
        const path = new URL(request.url, "http://localhost").pathname;
        dealId = decodeURIComponent(path.slice("/api/judgments/".length));
      } catch {
        sendJson(response, 400, { success: false, error: "Deal ID must be URL encoded" });
        return;
      }

      if (!dealId.trim()) {
        sendJson(response, 400, { success: false, error: "Deal ID is required" });
        return;
      }

      try {
        const record = await readPersistedJudgment(dealId);
        if (!record) {
          sendJson(response, 404, { success: false, error: "Judgment not found" });
          return;
        }

        const rubricHash = hashCanonicalValue(record.acceptanceCriteria);
        const deliverableHash = hashCanonicalValue(record.deliverable);
        const verified = verifyVerdictHash(record);

        const judgmentResponse = {
          ...record,
          rubricHash,
          deliverableHash,
          verified
        };

        sendJson(response, 200, judgmentResponse);
      } catch (error) {
        sendJson(response, 500, { success: false, error: error instanceof Error ? error.message : "Unable to read judgment" });
      }
      return;
    }

    sendJson(response, 404, {
      success: false,
      error: "Route not found",
    });
  }
);

if (process.env.ARBITRA_NO_LISTEN !== "true") {
  server.listen(PORT, () => {
    console.log(
      `Arbitra AI Judge API listening on http://localhost:${PORT}`
    );
  });

  // Start the background blockchain listener alongside the REST API
  startResilientOracle().catch(console.error);
}
