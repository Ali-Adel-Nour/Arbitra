// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Mock interface for ERC-8004 Validation Registry.
 * Used for logging agent task completion proofs natively on-chain.
 */
interface IValidationRegistry {
    /**
     * @notice Logs a task completion proof to the agent's profile.
     * @param agent The address of the agent completing the task.
     * @param dealId The unique identifier of the task/escrow.
     * @param success Whether the AI Court marked the task as successfully completed.
     * @param proofData The IPFS hash or reasoning string representing the AI verdict.
     */
    function logCompletion(address agent, bytes32 dealId, bool success, string calldata proofData) external;
}

/**
 * @dev Mock interface for ERC-8004 Reputation Registry.
 * Used for storing quantifiable feedback for agent profiles.
 */
interface IReputationRegistry {
    /**
     * @notice Logs a quantitative score and feedback for an agent.
     * @param agent The address of the agent being scored.
     * @param dealId The unique identifier of the task/escrow.
     * @param score The score given by the AI Court (e.g. 0-100).
     * @param reasoning The AI Court's justification for the score.
     */
    function logFeedback(address agent, bytes32 dealId, uint8 score, string calldata reasoning) external;
}
