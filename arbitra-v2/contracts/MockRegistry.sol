// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8004.sol";

/**
 * @title MockRegistry
 * @dev Mocks both the ERC-8004 Validation and Reputation Registries for local testing.
 * Includes the exact view functions required by the MCP server.
 */
contract MockRegistry is IValidationRegistry, IReputationRegistry {
    struct Feedback {
        bytes32 dealId;
        uint8 score;
        string reasoning;
    }

    mapping(address => Feedback[]) public agentHistory;
    mapping(address => uint256) public totalScore;
    mapping(address => uint256) public totalTasks;

    /**
     * @notice Logs a task completion proof to the agent's profile.
     */
    function logCompletion(address agent, bytes32 dealId, bool success, string calldata proofData) external override {
        // Mock logging for validation registry (we just consume the event for the test)
    }

    /**
     * @notice Logs a quantitative score and feedback for an agent.
     */
    function logFeedback(address agent, bytes32 dealId, uint8 score, string calldata reasoning) external override {
        agentHistory[agent].push(Feedback(dealId, score, reasoning));
        totalScore[agent] += score;
        totalTasks[agent] += 1;
    }

    /**
     * @notice MCP Server Tool: get_agent_reputation (Score)
     */
    function getAgentScore(address agent) external view returns (uint8) {
        if (totalTasks[agent] == 0) return 0;
        return uint8(totalScore[agent] / totalTasks[agent]);
    }

    /**
     * @notice MCP Server Tool: get_agent_reputation (History)
     */
    function getAgentHistory(address agent) external view returns (bytes32[] memory dealIds, uint8[] memory scores, string[] memory reasonings) {
        Feedback[] memory history = agentHistory[agent];
        uint256 length = history.length;

        dealIds = new bytes32[](length);
        scores = new uint8[](length);
        reasonings = new string[](length);

        for (uint256 i = 0; i < length; i++) {
            dealIds[i] = history[i].dealId;
            scores[i] = history[i].score;
            reasonings[i] = history[i].reasoning;
        }
    }
}
