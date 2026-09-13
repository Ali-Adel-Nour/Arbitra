import type { EscrowDeal } from "@prisma/client";

import type {
  AuditableVerdict,
  VerifiableVerdictRecord,
} from "./ai-judge/verdict.js";
import { prisma } from "./lib/prisma.js";

export type PersistedDeal = Pick<
  EscrowDeal,
  | "dealId"
  | "buyerAddress"
  | "sellerAddress"
  | "criteriaText"
  | "deliverableText"
  | "taskCategory"
  | "deadline"
  | "state"
  | "aiVerdict"
  | "aiReasoning"
  | "aiScore"
  | "verdictHash"
  | "resolvedTxHash"
  | "evaluationPrompt"
  | "modelId"
  | "modelVersion"
  | "rawLlmResponse"
  | "createdAt"
  | "updatedAt"
>;

export type JudgmentRecord = VerifiableVerdictRecord & {
  timestamp: string;
  state?: string;
  resolvedTxHash?: string;
};

export async function persistVerdict(
  verdict: AuditableVerdict,
  state = "JUDGED"
): Promise<PersistedDeal> {
  return prisma.escrowDeal.upsert({
    where: { dealId: verdict.dealId },
    create: {
      dealId: verdict.dealId,
      buyerAddress: verdict.buyer,
      sellerAddress: verdict.seller,
      criteriaText: JSON.stringify(verdict.acceptanceCriteria),
      deliverableText: verdict.deliverable,
      taskCategory: verdict.taskCategory,
      deadline: new Date(verdict.deadline),
      state,
      aiVerdict: verdict.approved,
      aiReasoning: verdict.reasoning,
      aiScore: verdict.score,
      verdictHash: verdict.verdictHash,
      evaluationPrompt: verdict.evaluationPrompt,
      modelId: verdict.modelId,
      modelVersion: verdict.modelVersion,
      rawLlmResponse: verdict.rawResponse,
    },
    update: {
      buyerAddress: verdict.buyer,
      sellerAddress: verdict.seller,
      criteriaText: JSON.stringify(verdict.acceptanceCriteria),
      deliverableText: verdict.deliverable,
      taskCategory: verdict.taskCategory,
      deadline: new Date(verdict.deadline),
      state,
      aiVerdict: verdict.approved,
      aiReasoning: verdict.reasoning,
      aiScore: verdict.score,
      verdictHash: verdict.verdictHash,
      evaluationPrompt: verdict.evaluationPrompt,
      modelId: verdict.modelId,
      modelVersion: verdict.modelVersion,
      rawLlmResponse: verdict.rawResponse,
    },
  });
}

export async function markDealResolved(
  dealId: string,
  resolvedTxHash: string
): Promise<void> {
  await prisma.escrowDeal.update({
    where: { dealId },
    data: { resolvedTxHash, state: "RESOLVED" },
  });
}

export async function persistPreimage(
  dealId: string,
  criteria?: string[],
  deliverable?: string
): Promise<void> {
  const updateData: any = {};
  const createData: any = { dealId };

  if (criteria !== undefined) {
    updateData.criteriaText = JSON.stringify(criteria);
    createData.criteriaText = JSON.stringify(criteria);
  }
  if (deliverable !== undefined) {
    updateData.deliverableText = deliverable;
    createData.deliverableText = deliverable;
  }

  await prisma.escrowDeal.upsert({
    where: { dealId },
    update: updateData,
    create: createData,
  });
}

export async function readPersistedDeals(
  sellerAddress: string
): Promise<PersistedDeal[]> {
  return prisma.escrowDeal.findMany({
    where: { sellerAddress, aiVerdict: { not: null } },
    orderBy: { createdAt: "asc" },
  });
}

export async function readAllPersistedDeals(): Promise<PersistedDeal[]> {
  return prisma.escrowDeal.findMany({
    orderBy: { createdAt: "desc" },
    take: 100, // Limit to recent deals
  });
}

/**
 * One deal by its identifier, or `null` if no row exists under it.
 *
 * The single-deal counterpart to `readAllPersistedDeals`. `GET /api/deals`
 * (the list) and `GET /api/deals/:dealId` (one record, read when a docket row
 * is clicked) both need the same shaping applied to a `PersistedDeal` — see
 * `shapeDealForFrontend` in `server.ts` — and this is what the single-item
 * route reads before shaping.
 */
export async function readOnePersistedDeal(
  dealId: string
): Promise<PersistedDeal | null> {
  return prisma.escrowDeal.findUnique({ where: { dealId } });
}

function parseAcceptanceCriteria(criteriaText: string | null): string[] {
  if (!criteriaText) return [];

  try {
    const parsed: unknown = JSON.parse(criteriaText);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export async function readPersistedJudgment(
  dealId: string
): Promise<JudgmentRecord | null> {
  const deal = await prisma.escrowDeal.findUnique({ where: { dealId } });
  if (
    !deal ||
    deal.aiVerdict === null ||
    deal.aiReasoning === null ||
    deal.aiScore === null ||
    deal.verdictHash === null ||
    deal.evaluationPrompt === null ||
    deal.modelId === null ||
    deal.modelVersion === null ||
    deal.rawLlmResponse === null ||
    deal.deliverableText === null ||
    deal.deadline === null
  ) {
    return null;
  }

  const acceptanceCriteria = parseAcceptanceCriteria(deal.criteriaText);
  return {
    dealId: deal.dealId,
    buyer: deal.buyerAddress ?? undefined,
    seller: deal.sellerAddress ?? undefined,
    taskCategory: deal.taskCategory ?? undefined,
    deadline: deal.deadline.toISOString(),
    acceptanceCriteria,
    deliverable: deal.deliverableText,
    approved: deal.aiVerdict,
    score: deal.aiScore,
    reasoning: deal.aiReasoning,
    verdict: deal.aiVerdict ? "PASS" : "FAIL",
    modelId: deal.modelId,
    modelVersion: deal.modelVersion,
    evaluationPrompt: deal.evaluationPrompt,
    rawResponse: deal.rawLlmResponse,
    verdictHash: deal.verdictHash,
    timestamp: deal.updatedAt.toISOString(),
    state: deal.state ?? undefined,
    resolvedTxHash: deal.resolvedTxHash ?? undefined,
  };
}
