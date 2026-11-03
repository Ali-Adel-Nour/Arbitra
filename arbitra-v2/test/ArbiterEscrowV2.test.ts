import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as crypto from "crypto";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ArbiterEscrowV2 Comprehensive Test Suite", function () {
    let mockRegistry: any;
    let mockToken: any;
    let feeToken: any;
    let escrow: any;
    let buyer: any;
    let seller: any;
    let stranger: any;
    
    // secp256r1 AI Judge Keypair
    let privateKey: crypto.KeyObject;
    let oraclePubKeyX: string;
    let oraclePubKeyY: string;

    const DEAL_SALT_1 = ethers.id("deal-001");
    const DEAL_SALT_2 = ethers.id("deal-002");
    const DEAL_SALT_3 = ethers.id("deal-003");
    const DEAL_SALT_4 = ethers.id("deal-004");
    const DEAL_SALT_5 = ethers.id("deal-005");
    const DEAL_SALT_FOT_1 = ethers.id("deal-fot-001");
    const DEAL_SALT_FOT_2 = ethers.id("deal-fot-002");

    let dealId1: string;
    let dealId2: string;
    let dealId3: string;
    let dealId4: string;
    let dealId5: string;

    const CRITERIA = "Deliver a valid Python script that prints Hello World.";
    const DELIVERABLE_HASH = ethers.id("print('Hello World')");
    const AMOUNT = ethers.parseUnits("100", 18);
    const ONE_DAY = 24 * 60 * 60;

    before(async function () {
        [buyer, seller, stranger] = await ethers.getSigners();

        // 1. Generate secp256r1 (P256) keypair using Node.js crypto
        const keypair = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1'
        });
        privateKey = keypair.privateKey;
        
        const rawPub = keypair.publicKey.export({ format: 'jwk' });
        oraclePubKeyX = "0x" + Buffer.from(rawPub.x!, 'base64url').toString('hex').padStart(64, '0');
        oraclePubKeyY = "0x" + Buffer.from(rawPub.y!, 'base64url').toString('hex').padStart(64, '0');

        // Mock the EIP-7951 precompile at 0x0100 to return 1 (success)
        const mockPrecompileBytecode = "0x600160005260206000f3"; 
        await network.provider.send("hardhat_setCode", [
            "0x0000000000000000000000000000000000000100",
            mockPrecompileBytecode
        ]);
    });

    async function generateSignature(dealId: string, success: boolean, score: number, reasoning: string) {
        const networkId = await ethers.provider.getNetwork();
        const chainId = networkId.chainId;
        const contractAddress = await escrow.getAddress();
        const hashedReasoning = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

        const abiCoder = new ethers.AbiCoder();
        const encodedHex = abiCoder.encode(
            ['uint256', 'address', 'bytes32', 'bool', 'uint8', 'bytes32'],
            [chainId, contractAddress, dealId, success, score, hashedReasoning]
        );
        
        const rawPayload = Buffer.from(encodedHex.slice(2), 'hex');
        const signatureP1363 = crypto.sign('sha256', rawPayload, {
            key: privateKey,
            dsaEncoding: 'ieee-p1363'
        });

        return {
            r: "0x" + signatureP1363.subarray(0, 32).toString('hex'),
            s: "0x" + signatureP1363.subarray(32, 64).toString('hex')
        };
    }

    it("should deploy infrastructure", async function () {
        const MockRegistry = await ethers.getContractFactory("MockRegistry");
        mockRegistry = await MockRegistry.deploy();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy();

        const MockFeeOnTransferERC20 = await ethers.getContractFactory("MockFeeOnTransferERC20");
        feeToken = await MockFeeOnTransferERC20.deploy();

        await mockToken.transfer(buyer.address, AMOUNT * 20n);
        await mockToken.transfer(stranger.address, AMOUNT * 5n);
        await feeToken.transfer(buyer.address, AMOUNT * 20n);

        const ArbiterEscrowV2 = await ethers.getContractFactory("ArbiterEscrowV2");
        escrow = await ArbiterEscrowV2.deploy(
            await mockRegistry.getAddress(),
            await mockRegistry.getAddress(),
            oraclePubKeyX,
            oraclePubKeyY
        );

        await mockToken.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 20n);
        await mockToken.connect(stranger).approve(await escrow.getAddress(), AMOUNT * 5n);
        await feeToken.connect(buyer).approve(await escrow.getAddress(), AMOUNT * 20n);

        dealId1 = await escrow.computeDealId(buyer.address, DEAL_SALT_1);
        dealId2 = await escrow.computeDealId(buyer.address, DEAL_SALT_2);
        dealId3 = await escrow.computeDealId(buyer.address, DEAL_SALT_3);
        dealId4 = await escrow.computeDealId(buyer.address, DEAL_SALT_4);
        dealId5 = await escrow.computeDealId(buyer.address, DEAL_SALT_5);
    });

    describe("Creating Escrows & Front-Running Protection", function () {
        it("should revert createEscrow with a past deadline", async function () {
            const pastDeadline = (await time.latest()) - 100;
            await expect(
                escrow.connect(buyer).createEscrow(DEAL_SALT_1, seller.address, await mockToken.getAddress(), AMOUNT, pastDeadline, CRITERIA)
            ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
        });

        it("should prevent dealSalt front-running by another user", async function () {
            const deadline = (await time.latest()) + ONE_DAY;
            const strangerDealId = await escrow.computeDealId(stranger.address, DEAL_SALT_1);

            // Stranger front-runs using the exact same DEAL_SALT_1
            await expect(
                escrow.connect(stranger).createEscrow(DEAL_SALT_1, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA)
            ).to.emit(escrow, "EscrowCreated")
             .withArgs(strangerDealId, stranger.address, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);

            // Buyer's transaction with DEAL_SALT_1 still succeeds because dealId is namespaced to msg.sender
            await expect(
                escrow.connect(buyer).createEscrow(DEAL_SALT_1, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA)
            ).to.emit(escrow, "EscrowCreated")
             .withArgs(dealId1, buyer.address, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);
            
            expect(await mockToken.balanceOf(await escrow.getAddress())).to.equal(AMOUNT * 2n);
        });

        it("should revert if the same buyer creates a deal with the same salt twice", async function () {
            const deadline = (await time.latest()) + ONE_DAY;
            await expect(
                escrow.connect(buyer).createEscrow(DEAL_SALT_1, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA)
            ).to.be.revertedWithCustomError(escrow, "DealExists");
        });
    });

    describe("Refunding Unsubmitted Escrows (Seller Ghosted)", function () {
        it("should revert refundEscrow if deadline has not passed", async function () {
            await expect(
                escrow.connect(buyer).refundEscrow(dealId1)
            ).to.be.revertedWithCustomError(escrow, "EscrowNotExpired");
        });

        it("should revert refundEscrow if called by a non-buyer", async function () {
            await time.increase(ONE_DAY + 1);
            await expect(
                escrow.connect(stranger).refundEscrow(dealId1)
            ).to.be.revertedWithCustomError(escrow, "OnlyBuyer");
        });

        it("should successfully refundEscrow immediately after deadline if seller never submitted", async function () {
            const buyerBalanceBefore = await mockToken.balanceOf(buyer.address);
            
            await expect(
                escrow.connect(buyer).refundEscrow(dealId1)
            ).to.emit(escrow, "EscrowRefunded").withArgs(dealId1);

            const buyerBalanceAfter = await mockToken.balanceOf(buyer.address);
            expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(AMOUNT);
        });

        it("should revert refundEscrow if already resolved (refunded)", async function () {
            await expect(
                escrow.connect(buyer).refundEscrow(dealId1)
            ).to.be.revertedWithCustomError(escrow, "AlreadyResolved");
        });
    });

    describe("Deliverable Submission & ORACLE_TIMEOUT Refund Protection", function () {
        before(async function () {
            const deadline = (await time.latest()) + ONE_DAY;
            await escrow.connect(buyer).createEscrow(DEAL_SALT_4, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);
            await escrow.connect(buyer).createEscrow(DEAL_SALT_5, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);
        });

        it("should revert submitDeliverable if called by non-seller", async function () {
            await expect(
                escrow.connect(buyer).submitDeliverable(dealId4, DELIVERABLE_HASH)
            ).to.be.revertedWithCustomError(escrow, "OnlySeller");
        });

        it("should allow seller to submitDeliverable before deadline", async function () {
            await expect(
                escrow.connect(seller).submitDeliverable(dealId4, DELIVERABLE_HASH)
            ).to.emit(escrow, "DeliverableSubmitted").withArgs(dealId4, DELIVERABLE_HASH);

            await expect(
                escrow.connect(seller).submitDeliverable(dealId5, DELIVERABLE_HASH)
            ).to.emit(escrow, "DeliverableSubmitted").withArgs(dealId5, DELIVERABLE_HASH);
        });

        it("should block buyer from refunding after deadline while within ORACLE_TIMEOUT grace period", async function () {
            // Advance past deadline by 1 hour (still inside 24h ORACLE_TIMEOUT)
            await time.increase(ONE_DAY + 3600);

            await expect(
                escrow.connect(buyer).refundEscrow(dealId4)
            ).to.be.revertedWithCustomError(escrow, "EscrowNotExpired");
        });

        it("should allow Oracle to resolveEscrow during the ORACLE_TIMEOUT window after deadline", async function () {
            const success = true;
            const score = 98;
            const reasoning = "Delivered on time before deadline; verified during oracle window.";
            const { r, s } = await generateSignature(dealId4, success, score, reasoning);

            const sellerBalanceBefore = await mockToken.balanceOf(seller.address);

            await expect(
                escrow.resolveEscrow(dealId4, success, score, reasoning, r, s)
            ).to.emit(escrow, "EscrowResolved").withArgs(dealId4, true);

            const sellerBalanceAfter = await mockToken.balanceOf(seller.address);
            expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(AMOUNT);
        });

        it("should allow buyer to refund submitted deal if Oracle ghosts past ORACLE_TIMEOUT", async function () {
            // Advance another 24 hours past ORACLE_TIMEOUT
            await time.increase(ONE_DAY + 1);

            const buyerBalanceBefore = await mockToken.balanceOf(buyer.address);
            await expect(
                escrow.connect(buyer).refundEscrow(dealId5)
            ).to.emit(escrow, "EscrowRefunded").withArgs(dealId5);

            const buyerBalanceAfter = await mockToken.balanceOf(buyer.address);
            expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(AMOUNT);
        });
    });

    describe("Resolving Escrows (AI Judge)", function () {
        before(async function () {
            const deadline = (await time.latest()) + ONE_DAY;
            await escrow.connect(buyer).createEscrow(DEAL_SALT_2, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);
            await escrow.connect(buyer).createEscrow(DEAL_SALT_3, seller.address, await mockToken.getAddress(), AMOUNT, deadline, CRITERIA);
        });

        it("should revert resolveEscrow on invalid score > 100", async function () {
            const success = true;
            const score = 95;
            const reasoning = "Excellent work.";
            const { r, s } = await generateSignature(dealId2, success, score, reasoning);

            await expect(
                escrow.resolveEscrow(dealId2, success, 105, reasoning, r, s)
            ).to.be.revertedWithCustomError(escrow, "ScoreExceeds100");
        });

        it("should resolveEscrow with success=false (unhappy path, funds to buyer)", async function () {
            const success = false;
            const score = 30;
            const reasoning = "Failed to meet acceptance criteria.";
            const { r, s } = await generateSignature(dealId2, success, score, reasoning);

            const buyerBalanceBefore = await mockToken.balanceOf(buyer.address);

            await expect(escrow.resolveEscrow(dealId2, success, score, reasoning, r, s))
                .to.emit(escrow, "EscrowResolved")
                .withArgs(dealId2, false);

            const buyerBalanceAfter = await mockToken.balanceOf(buyer.address);
            expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(AMOUNT);
            
            const agentScore = await mockRegistry.getAgentScore(seller.address);
            // Average of previous 98 score (dealId4) and this 30 score (dealId2) = (98 + 30) / 2 = 64
            expect(agentScore).to.equal(64);
        });

        it("should successfully resolveEscrow with success=true (funds to seller)", async function () {
            const success = true;
            const score = 95;
            const reasoning = "Perfect.";
            const { r, s } = await generateSignature(dealId3, success, score, reasoning);

            const sellerBalanceBefore = await mockToken.balanceOf(seller.address);

            await expect(escrow.resolveEscrow(dealId3, success, score, reasoning, r, s))
                .to.emit(escrow, "EscrowResolved")
                .withArgs(dealId3, true);

            const sellerBalanceAfter = await mockToken.balanceOf(seller.address);
            expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(AMOUNT);
        });

        it("should revert on double resolveEscrow", async function () {
            const success = true;
            const score = 95;
            const reasoning = "Perfect.";
            const { r, s } = await generateSignature(dealId3, success, score, reasoning);

            await expect(
                escrow.resolveEscrow(dealId3, success, score, reasoning, r, s)
            ).to.be.revertedWithCustomError(escrow, "AlreadyResolved");
        });
    });

    describe("Fee-On-Transfer Token Accounting", function () {
        it("should record exact post-fee balance delta and never drain other deals", async function () {
            const deadline = (await time.latest()) + ONE_DAY;
            const fotDealId1 = await escrow.computeDealId(buyer.address, DEAL_SALT_FOT_1);
            const fotDealId2 = await escrow.computeDealId(buyer.address, DEAL_SALT_FOT_2);

            // 5% fee on 100 tokens -> contract receives 95 tokens per deal
            const expectedReceived = (AMOUNT * 95n) / 100n;

            await expect(
                escrow.connect(buyer).createEscrow(DEAL_SALT_FOT_1, seller.address, await feeToken.getAddress(), AMOUNT, deadline, CRITERIA)
            ).to.emit(escrow, "EscrowCreated")
             .withArgs(fotDealId1, buyer.address, seller.address, await feeToken.getAddress(), expectedReceived, deadline, CRITERIA);

            await expect(
                escrow.connect(buyer).createEscrow(DEAL_SALT_FOT_2, seller.address, await feeToken.getAddress(), AMOUNT, deadline, CRITERIA)
            ).to.emit(escrow, "EscrowCreated")
             .withArgs(fotDealId2, buyer.address, seller.address, await feeToken.getAddress(), expectedReceived, deadline, CRITERIA);

            // Resolve first FOT deal -> pays out from its own 95-token allocation without touching deal 2
            const { r: r1, s: s1 } = await generateSignature(fotDealId1, true, 90, "FOT Deal 1 Pass");
            await expect(escrow.resolveEscrow(fotDealId1, true, 90, "FOT Deal 1 Pass", r1, s1))
                .to.emit(escrow, "EscrowResolved")
                .withArgs(fotDealId1, true);

            // Resolve second FOT deal -> succeeds cleanly with zero balance shortfall
            const { r: r2, s: s2 } = await generateSignature(fotDealId2, false, 20, "FOT Deal 2 Fail");
            await expect(escrow.resolveEscrow(fotDealId2, false, 20, "FOT Deal 2 Fail", r2, s2))
                .to.emit(escrow, "EscrowResolved")
                .withArgs(fotDealId2, false);

            expect(await feeToken.balanceOf(await escrow.getAddress())).to.equal(0n);
        });
    });
});
