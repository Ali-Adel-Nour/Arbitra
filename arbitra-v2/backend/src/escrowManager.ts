import { ethers } from "ethers";
import * as dotenv from "dotenv";
import { P256Signer } from "./signer.js";
import { submitBtxSettlement } from "./settle.js";

dotenv.config();

// 1. Initialize the P256Signer using the Oracle's Private Key from .env
const oraclePrivateKey = process.env.ORACLE_P256_PRIVATE_KEY;
if (!oraclePrivateKey) {
    throw new Error("Missing ORACLE_P256_PRIVATE_KEY in environment variables.");
}
const signer = new P256Signer(oraclePrivateKey);

/**
 * Mock function representing the AI Court evaluating a deliverable.
 * In a real implementation, this would call an LLM with the prompt, 
 * acceptance criteria, and seller's deliverable.
 */
async function judgeDeliverable(dealId: string): Promise<{ success: boolean; score: number; reasoning: string }> {
    console.log(`[AI Judge] Evaluating deal: ${dealId}...`);
    
    // Simulate AI processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock deterministic verdict for hackathon demo
    return {
        success: true,
        score: 92,
        reasoning: "The deliverable met all acceptance criteria perfectly. Code is modular and well-tested."
    };
}

/**
 * Orchestrator function to process a deal settlement end-to-end.
 */
export async function processDealSettlement(dealId: string) {
    console.log(`Starting settlement process for deal: ${dealId}`);

    // Environment Validation
    const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
    const escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    const standardRpc = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";
    const btxRpc = process.env.MONAD_BTX_RPC_URL || "https://rpc-monad-btx.testnet";

    if (!operatorPrivateKey || !escrowAddress) {
        throw new Error("Missing OPERATOR_PRIVATE_KEY or ESCROW_CONTRACT_ADDRESS in environment variables.");
    }

    // Initialize operator wallet (for gas)
    const operatorWallet = new ethers.Wallet(operatorPrivateKey);

    // 1. Get the verdict from the AI Judge
    const verdict = await judgeDeliverable(dealId);
    console.log(`Verdict reached: Success=${verdict.success}, Score=${verdict.score}`);

    // 2. Submit the settlement securely via BTX RPC
    try {
        const txHash = await submitBtxSettlement(
            dealId,
            verdict.success,
            verdict.score,
            verdict.reasoning,
            signer,
            operatorWallet,
            escrowAddress,
            standardRpc,
            btxRpc
        );

        console.log(`Deal ${dealId} settled successfully. BTX TX Hash: ${txHash}`);
    } catch (error) {
        console.error(`Failed to settle deal ${dealId}:`, error);
    }
}
