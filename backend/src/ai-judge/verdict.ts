import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { keccak256, toUtf8Bytes } from "ethers";

import { judgeDeliverable } from "./judge.js";
import type { JudgeResult } from "./types.js";
import { persistVerdict as persistEscrowVerdict } from "../persistence.js";

export interface DealJudgeInput {
  dealId: string;
  acceptanceCriteria: string[];
  deliverable: string;
  deadline: string | number;
  buyer?: string;
  seller?: string;
  taskCategory?: string;
}

export interface AuditableVerdict {
  dealId: string;
  buyer?: string;
  seller?: string;
  taskCategory?: string;
  deadline: string;
  acceptanceCriteria: string[];
  deliverable: string;
  approved: boolean;
  score: number;
  reasoning: string;
  modelId: string;
  modelVersion: string;
  evaluationPrompt: string;
  rawResponse: string;
  rubricHash: string;
  deliverableHash: string;
  verdictHash: string;
  timestamp: string;
}

export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);

    return `{${entries.join(",")}}`;
  }

  return value === undefined ? "null" : JSON.stringify(value);
}

export function hashCanonicalValue(value: unknown): string {
  return keccak256(toUtf8Bytes(canonicalize(value)));
}

export interface VerifiableVerdictRecord {
  dealId: string;
  buyer?: string;
  seller?: string;
  taskCategory?: string;
  deadline: string;
  acceptanceCriteria: string[];
  deliverable: string;
  approved: boolean;
  score: number;
  reasoning: string;
  verdict: "PASS" | "FAIL";
  modelId: string;
  modelVersion: string;
  evaluationPrompt: string;
  rawResponse: string;
  verdictHash: string;
}

export function calculateVerdictHash(record: VerifiableVerdictRecord): string {
  const deliverableHash = hashCanonicalValue(record.deliverable);
  const rubricHash = hashCanonicalValue(record.acceptanceCriteria);

  return hashCanonicalValue({
    acceptanceCriteria: record.acceptanceCriteria,
    approved: record.approved,
    buyer: record.buyer,
    dealId: record.dealId,
    deliverable: record.deliverable,
    deliverableHash,
    deadline: normalizeDeadline(record.deadline),
    evaluationPrompt: record.evaluationPrompt,
    modelId: record.modelId,
    modelVersion: record.modelVersion,
    rawResponse: record.rawResponse,
    reasoning: record.reasoning,
    rubricHash,
    score: record.score,
    seller: record.seller,
    taskCategory: record.taskCategory,
    verdict: record.verdict,
  });
}

export function verifyVerdictHash(record: VerifiableVerdictRecord): boolean {
  return calculateVerdictHash(record) === record.verdictHash;
}

export function normalizeDeadline(deadline: string | number): string {
  const date = new Date(
    typeof deadline === "number" ? deadline * 1000 : deadline
  );

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid deadline");
  }

  return date.toISOString();
}

function getModelMetadata(): Pick<AuditableVerdict, "modelId" | "modelVersion"> {
  const modelId = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const modelVersion = process.env.LLM_MODEL_VERSION ?? modelId;

  return { modelId, modelVersion };
}

export function buildVerdict(
  input: DealJudgeInput,
  result: JudgeResult
): AuditableVerdict {
  const configuredModel = getModelMetadata();
  const model = {
    modelId: result.modelId ?? configuredModel.modelId,
    modelVersion: result.modelVersion ?? configuredModel.modelVersion,
  };
  const normalizedDeadline = normalizeDeadline(input.deadline);
  const rubricHash = hashCanonicalValue(input.acceptanceCriteria);
  const deliverableHash = hashCanonicalValue(input.deliverable);
  const score = result.approved ? 100 : 0;
  const evaluationPrompt = result.evaluationPrompt ?? "";
  const rawResponse = result.rawResponse ?? "";

  // The evaluation timestamp is recorded for auditability but deliberately excluded
  // from the hash payload so identical inputs and model metadata produce one hash.
  const verdictPayload = {
    acceptanceCriteria: input.acceptanceCriteria,
    approved: result.approved,
    buyer: input.buyer,
    dealId: input.dealId,
    deliverable: input.deliverable,
    deliverableHash,
    deadline: normalizedDeadline,
    evaluationPrompt,
    modelId: model.modelId,
    modelVersion: model.modelVersion,
    rawResponse,
    reasoning: result.reasoning,
    rubricHash,
    score,
    seller: input.seller,
    taskCategory: input.taskCategory,
    verdict: result.verdict,
  };

  return {
    ...verdictPayload,
    deadline: normalizedDeadline,
    verdictHash: hashCanonicalValue(verdictPayload),
    timestamp: new Date().toISOString(),
  };
}

export async function evaluateDeal(
  input: DealJudgeInput
): Promise<AuditableVerdict> {
  const result = await judgeDeliverable({
    task: [
      `Evaluate the deliverable for deal ${input.dealId}.`,
      `The deliverable must satisfy every acceptance criterion and be completed by ${normalizeDeadline(input.deadline)}.`,
      "The deadline is evaluation context; do not approve work submitted after it.",
    ].join(" "),
    acceptanceCriteria: input.acceptanceCriteria,
    deliverable: input.deliverable,
  });

  const verdict = buildVerdict(input, result);
  await persistVerdict(verdict);
  await persistEscrowVerdict(verdict);
  
  // Asynchronously pin to IPFS (doesn't block the API return)
  import("../ipfs.js").then((ipfs) => ipfs.uploadToIPFS(verdict));
  
  return verdict;
}

async function persistVerdict(verdict: AuditableVerdict): Promise<void> {
  // JSONL is retained only as an explicit legacy/demo fixture mode. Prisma is
  // the application persistence path by default.
  if (process.env.ARBITRA_PERSISTENCE !== "jsonl") return;
  const filePath =
    process.env.VERDICT_STORE_PATH ?? "backend/data/verdicts.jsonl";

  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${canonicalize(verdict)}\n`, "utf8");
}
