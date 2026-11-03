// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8004.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ArbiterEscrowV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // EIP-7951 Precompile Address
    address public constant P256_PRECOMPILE = address(0x0100);

    // Grace period after deadline for the AI Oracle to resolve a submitted deal before buyer can refund
    uint256 public constant ORACLE_TIMEOUT = 24 hours;

    IValidationRegistry public validationRegistry;
    IReputationRegistry public reputationRegistry;

    bytes32 public oraclePubKeyX;
    bytes32 public oraclePubKeyY;

    error InvalidValidationRegistry();
    error InvalidReputationRegistry();
    error InvalidOraclePublicKey();
    error DealExists();
    error DealNotFound();
    error AlreadyResolved();
    error AlreadySubmitted();
    error InvalidSeller();
    error InvalidToken();
    error InvalidDeliverable();
    error ZeroAmount();
    error ScoreExceeds100();
    error P256PrecompileFailed();
    error InvalidSignature();
    error EscrowNotExpired();
    error DeadlinePassed();
    error OnlyBuyer();
    error OnlySeller();
    error InvalidDeadline();

    struct Deal {
        address buyer;
        address seller;
        IERC20 token;
        bool isSubmitted;
        bool isResolved;
        uint256 amount;
        uint256 deadline;
        bytes32 deliverableHash;
    }

    mapping(bytes32 => Deal) public deals;

    event EscrowCreated(
        bytes32 indexed dealId,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount,
        uint256 deadline,
        string acceptanceCriteria
    );
    event DeliverableSubmitted(bytes32 indexed dealId, bytes32 deliverableHash);
    event EscrowResolved(bytes32 indexed dealId, bool success);
    event EscrowRefunded(bytes32 indexed dealId);

    constructor(
        address _validationRegistry, 
        address _reputationRegistry,
        bytes32 _oraclePubKeyX,
        bytes32 _oraclePubKeyY
    ) {
        if (_validationRegistry.code.length == 0) revert InvalidValidationRegistry();
        if (_reputationRegistry.code.length == 0) revert InvalidReputationRegistry();
        if (_oraclePubKeyX == bytes32(0) || _oraclePubKeyY == bytes32(0)) revert InvalidOraclePublicKey();

        validationRegistry = IValidationRegistry(_validationRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        oraclePubKeyX = _oraclePubKeyX;
        oraclePubKeyY = _oraclePubKeyY;
    }

    /**
     * @notice Computes the front-running resistant dealId namespaced to the buyer's address.
     * @param buyer The address of the buyer creating the deal.
     * @param dealSalt The client-provided salt/identifier for the deal.
     */
    function computeDealId(address buyer, bytes32 dealSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(buyer, dealSalt));
    }

    /**
     * @notice Creates a new agent escrow and locks funds.
     * @dev Namespaces the client-provided dealSalt with msg.sender to prevent front-running
     * and measures exact token balance deltas to support fee-on-transfer tokens.
     */
    function createEscrow(
        bytes32 dealSalt,
        address seller,
        IERC20 token,
        uint256 amount,
        uint256 deadline,
        string calldata acceptanceCriteria
    ) external nonReentrant returns (bytes32 dealId) {
        dealId = computeDealId(msg.sender, dealSalt);
        if (deals[dealId].buyer != address(0)) revert DealExists();
        if (seller == address(0)) revert InvalidSeller();
        if (address(token) == address(0)) revert InvalidToken();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        // Measure exact balance delta to safely support Fee-On-Transfer (FOT) tokens
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 actualAmountReceived = token.balanceOf(address(this)) - balanceBefore;
        if (actualAmountReceived == 0) revert ZeroAmount();

        deals[dealId] = Deal({
            buyer: msg.sender,
            seller: seller,
            token: token,
            isSubmitted: false,
            isResolved: false,
            amount: actualAmountReceived,
            deadline: deadline,
            deliverableHash: bytes32(0)
        });

        emit EscrowCreated(dealId, msg.sender, seller, address(token), actualAmountReceived, deadline, acceptanceCriteria);
    }

    /**
     * @notice Allows the seller to record deliverable submission on-chain before the deadline.
     * @dev Locks buyer refunds for ORACLE_TIMEOUT (24 hours) past the deadline so the buyer
     * cannot front-run or snipe a refund while the AI Oracle is evaluating the work.
     */
    function submitDeliverable(bytes32 dealId, bytes32 deliverableHash) external {
        Deal storage deal = deals[dealId];
        if (deal.buyer == address(0)) revert DealNotFound();
        if (msg.sender != deal.seller) revert OnlySeller();
        if (deal.isResolved) revert AlreadyResolved();
        if (deal.isSubmitted) revert AlreadySubmitted();
        if (block.timestamp > deal.deadline) revert DeadlinePassed();
        if (deliverableHash == bytes32(0)) revert InvalidDeliverable();

        deal.isSubmitted = true;
        deal.deliverableHash = deliverableHash;

        emit DeliverableSubmitted(dealId, deliverableHash);
    }

    /**
     * @notice Resolves the escrow utilizing EIP-7951 signature verification.
     */
    function resolveEscrow(
        bytes32 dealId,
        bool success,
        uint8 score,
        string calldata reasoning,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        if (score > 100) revert ScoreExceeds100();
        if (r == bytes32(0) || s == bytes32(0)) revert InvalidSignature();
        Deal storage deal = deals[dealId];
        if (deal.buyer == address(0)) revert DealNotFound();
        if (deal.isResolved) revert AlreadyResolved();

        // 1. Secure Payload Hash (Prevents Cross-Chain & Cross-Contract Replay)
        bytes32 payloadHash = sha256(
            abi.encode(
                block.chainid,
                address(this),
                dealId,
                success,
                score,
                keccak256(bytes(reasoning))
            )
        );

        // 2. Verify signature using EIP-7951 (P256 Precompile)
        bytes memory input = abi.encodePacked(
            payloadHash,
            r,
            s,
            oraclePubKeyX,
            oraclePubKeyY
        );
        (bool callSuccess, bytes memory returnData) = P256_PRECOMPILE
            .staticcall(input);

        if (!callSuccess || returnData.length != 32)
            revert P256PrecompileFailed();
        if (abi.decode(returnData, (uint256)) != 1) revert InvalidSignature();

        // 3. Mark resolved and handle funds via SafeERC20
        deal.isResolved = true;
        if (success) {
            deal.token.safeTransfer(deal.seller, deal.amount);
        } else {
            deal.token.safeTransfer(deal.buyer, deal.amount);
        }

        // 4. Log to ERC-8004 Registries natively
        validationRegistry.logCompletion(
            deal.seller,
            dealId,
            success,
            reasoning
        );
        reputationRegistry.logFeedback(deal.seller, dealId, score, reasoning);

        emit EscrowResolved(dealId, success);
    }

    /**
     * @notice Allows the buyer to reclaim funds if the escrow deadline has passed
     * (plus ORACLE_TIMEOUT if the seller submitted work before the deadline)
     * and the AI Oracle has not resolved it.
     */
    function refundEscrow(bytes32 dealId) external nonReentrant {
        Deal storage deal = deals[dealId];
        if (deal.buyer == address(0)) revert DealNotFound();
        if (deal.buyer != msg.sender) revert OnlyBuyer();
        if (deal.isResolved) revert AlreadyResolved();

        uint256 earliestRefundTime = deal.isSubmitted
            ? deal.deadline + ORACLE_TIMEOUT
            : deal.deadline;
        if (block.timestamp <= earliestRefundTime) revert EscrowNotExpired();

        deal.isResolved = true;
        deal.token.safeTransfer(deal.buyer, deal.amount);

        emit EscrowRefunded(dealId);
    }
}
