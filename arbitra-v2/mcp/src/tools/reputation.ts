import { ethers } from 'ethers';

// ABI for the ERC-8004 Reputation Registry
// These view functions represent standard ways to read from a trustless agent registry
const REPUTATION_REGISTRY_ABI = [
    "function getAgentScore(address agent) external view returns (uint8)",
    "function getAgentHistory(address agent) external view returns (bytes32[] memory dealIds, uint8[] memory scores, string[] memory reasonings)"
];

/**
 * V2 MCP Tool: get_agent_reputation
 * 
 * Fetches the agent's reputation entirely from the ERC-8004 Reputation Registry.
 * The blockchain is the sole source of truth for the trust and data ownership layer.
 */
export async function get_agent_reputation(args: { agentAddress: string, registryAddress: string, rpcUrl: string }) {
    const { agentAddress, registryAddress, rpcUrl } = args;

    if (!agentAddress || !registryAddress || !rpcUrl) {
        return JSON.stringify({ error: "Missing required parameters: agentAddress, registryAddress, or rpcUrl" });
    }

    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const registry = new ethers.Contract(registryAddress, REPUTATION_REGISTRY_ABI, provider);

        // Directly query the ERC-8004 Registry as the absolute source of truth
        const currentScore = await registry.getAgentScore(agentAddress);
        const [dealIds, scores, reasonings] = await registry.getAgentHistory(agentAddress);

        // Format the output for the AI Agent
        const history = dealIds.map((id: string, index: number) => ({
            dealId: id,
            score: Number(scores[index]),
            reasoning: reasonings[index]
        }));

        return JSON.stringify({
            agent: agentAddress,
            source: "Monad ERC-8004 Registry",
            currentScore: Number(currentScore),
            totalDeals: dealIds.length,
            history: history
        }, null, 2);

    } catch (error) {
        return JSON.stringify({
            error: "Failed to fetch reputation from ERC-8004 registry",
            details: error instanceof Error ? error.message : "Unknown error"
        });
    }
}
