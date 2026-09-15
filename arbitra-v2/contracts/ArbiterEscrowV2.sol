// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC8004.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ArbiterEscrowV2 {
    using SafeERC20 for IERC20;

    // EIP-7951 Precompile Address
    address public constant P256_PRECOMPILE = address(0x0100);

    IValidationRegistry public validationRegistry;
    IReputationRegistry public reputationRegistry;

    bytes32 public oraclePubKeyX;
    bytes32 public oraclePubKeyY;

    error InvalidValidationRegistry();
    error InvalidReputationRegistry();
    error DealExists();
    error DealNotFound();
    error AlreadyResolved();
    error InvalidSeller();
    error ZeroAmount();
    error ScoreExceeds100();
    error P256PrecompileFailed();
    error InvalidSignature();

    struct Deal {
        address buyer;
        address seller;
        IERC20 token;
        uint256 amount;
        bool isResolved;
    }

    mapping(bytes32 => Deal) public deals;

    event EscrowCreated(
        bytes32 indexed dealId,
        address buyer,
        address seller,
        uint256 amount
    );
    event EscrowResolved(bytes32 indexed dealId, bool success);

   constructor(
        address _validationRegistry, 
        address _reputationRegistry,
        bytes32 _oraclePubKeyX,
        bytes32 _oraclePubKeyY
    ) {
        if(_validationRegistry.code.length == 0) revert InvalidValidationRegistry();
        if(_reputationRegistry.code.length == 0) revert InvalidReputationRegistry();

        validationRegistry = IValidationRegistry(_validationRegistry);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
        oraclePubKeyX = _oraclePubKeyX;
        oraclePubKeyY = _oraclePubKeyY;
    }
    /**
     * @notice Creates a new agent escrow and locks funds.
     * @dev Uses a client-provided dealId to save gas on state writes.
     */
    function createEscrow(
        bytes32 dealId,
        address seller,
        IERC20 token,
        uint256 amount
    ) external {
        if (deals[dealId].buyer != address(0)) revert DealExists();
        if (seller == address(0)) revert InvalidSeller();
        if (amount == 0) revert ZeroAmount();

        deals[dealId] = Deal({
            buyer: msg.sender,
            seller: seller,
            token: token,
            amount: amount,
            isResolved: false
        });

        // Safe transfer handles USDT and non-standard tokens
        token.safeTransferFrom(msg.sender, address(this), amount);

        emit EscrowCreated(dealId, msg.sender, seller, amount);
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
    ) external {
        if(score > 100) revert ScoreExceeds100();
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
}
