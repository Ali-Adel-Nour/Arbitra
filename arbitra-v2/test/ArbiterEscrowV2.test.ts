import { expect } from "chai";
import { ethers, network } from "hardhat";
import * as crypto from "crypto";

describe("ArbiterEscrowV2 End-to-End Test", function () {
    let mockRegistry: any;
    let mockToken: any;
    let escrow: any;
    let buyer: any;
    let seller: any;
    
    // secp256r1 AI Judge Keypair
    let privateKey: crypto.KeyObject;
    let oraclePubKeyX: string;
    let oraclePubKeyY: string;

    const DEAL_ID = ethers.id("deal-001");
    const AMOUNT = ethers.parseUnits("100", 18);

    before(async function () {
        [buyer, seller] = await ethers.getSigners();

        // 1. Generate secp256r1 (P256) keypair using Node.js crypto
        const keypair = crypto.generateKeyPairSync('ec', {
            namedCurve: 'prime256v1'
        });
        privateKey = keypair.privateKey;
        
        const rawPub = keypair.publicKey.export({ format: 'jwk' });
        oraclePubKeyX = "0x" + Buffer.from(rawPub.x!, 'base64url').toString('hex').padStart(64, '0');
        oraclePubKeyY = "0x" + Buffer.from(rawPub.y!, 'base64url').toString('hex').padStart(64, '0');

        // Note: Hardhat Network does not natively support the EIP-7951 precompile at 0x0100 yet.
        // For this local E2E test, we inject a mock precompile contract at 0x0100 that always returns 1 (true).
        // On Monad Testnet/Mainnet, the actual native precompile will cryptographically validate the inputs.
        // Bytecode meaning: mstore(0, 1); return(0, 32); -> returns exactly 32 bytes of 0x...01
        const mockPrecompileBytecode = "0x600160005260206000f3"; 
        await network.provider.send("hardhat_setCode", [
            "0x0000000000000000000000000000000000000100",
            mockPrecompileBytecode
        ]);
    });

    it("should deploy the Mock Registry and Mock Token", async function () {
        const MockRegistry = await ethers.getContractFactory("MockRegistry");
        mockRegistry = await MockRegistry.deploy();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        mockToken = await MockERC20.deploy();

        // Fund the buyer
        await mockToken.transfer(buyer.address, AMOUNT * 2n);
    });

    it("should deploy ArbiterEscrowV2 with P256 coordinates", async function () {
        const ArbiterEscrowV2 = await ethers.getContractFactory("ArbiterEscrowV2");
        escrow = await ArbiterEscrowV2.deploy(
            await mockRegistry.getAddress(),
            await mockRegistry.getAddress(),
            oraclePubKeyX,
            oraclePubKeyY
        );
    });

    it("should execute createEscrow and lock funds", async function () {
        await mockToken.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
        
        await expect(escrow.connect(buyer).createEscrow(DEAL_ID, seller.address, await mockToken.getAddress(), AMOUNT))
            .to.emit(escrow, "EscrowCreated")
            .withArgs(DEAL_ID, buyer.address, seller.address, AMOUNT);
            
        expect(await mockToken.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
    });

    it("should simulate backend Oracle and successfully resolveEscrow", async function () {
        const success = true;
        const score = 95;
        const reasoning = "Excellent work on the Python refactor.";

        // 1. Generate Domain-Separated payload hash exactly matching the smart contract
        const networkId = await ethers.provider.getNetwork();
        const chainId = networkId.chainId;
        const contractAddress = await escrow.getAddress();

        const hashedReasoning = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

        const abiCoder = new ethers.AbiCoder();
        const encodedHex = abiCoder.encode(
            ['uint256', 'address', 'bytes32', 'bool', 'uint8', 'bytes32'],
            [chainId, contractAddress, DEAL_ID, success, score, hashedReasoning]
        );
        
        // Convert to buffer
        const rawPayload = Buffer.from(encodedHex.slice(2), 'hex');

        // 2. Sign it using the secp256r1 private key
        // Node's crypto.sign('sha256') will hash the rawPayload before signing, 
        // matching the contract's sha256(abi.encode(...))
        const signatureP1363 = crypto.sign('sha256', rawPayload, {
            key: privateKey,
            dsaEncoding: 'ieee-p1363'
        });

        // 3. Extract r and s (IEEE-P1363 format guarantees exactly 64 bytes total)
        const r = "0x" + signatureP1363.subarray(0, 32).toString('hex');
        const s = "0x" + signatureP1363.subarray(32, 64).toString('hex');

        // 4. Call resolveEscrow
        await expect(escrow.resolveEscrow(DEAL_ID, success, score, reasoning, r, s))
            .to.emit(escrow, "EscrowResolved")
            .withArgs(DEAL_ID, success);

        // 5. Verify funds were transferred to the seller (because success = true)
        expect(await mockToken.balanceOf(seller.address)).to.equal(AMOUNT);
        expect(await mockToken.balanceOf(await escrow.getAddress())).to.equal(0);

        // 6. Verify MockRegistry was updated natively via ERC-8004
        const agentScore = await mockRegistry.getAgentScore(seller.address);
        expect(agentScore).to.equal(score);

        const history = await mockRegistry.getAgentHistory(seller.address);
        expect(history[0][0]).to.equal(DEAL_ID);       // dealIds
        expect(history[1][0]).to.equal(score);         // scores
        expect(history[2][0]).to.equal(reasoning);     // reasonings
    });
});
