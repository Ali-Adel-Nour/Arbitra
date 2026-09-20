import { ethers } from 'ethers';
import * as crypto from 'crypto';
import { P256Signer } from './signer.js';

// Using a mock AES key to simulate the BTX Threshold encryption for the hackathon.
// (A real production implementation uses pairing-friendly curves like BLS12-381 via a specialized BTX SDK).
const MOCK_BTX_SYMMETRIC_KEY = crypto.randomBytes(32);

/**
 * Encrypts a raw serialized transaction using the Monad BTX Threshold Public Key.
 * This ensures the transaction is encrypted in the mempool and only decrypted
 * when the block is proposed, preventing MEV front-running.
 */
function encryptForBtx(rawTx: string): string {
    const txBuffer = Buffer.from(rawTx.slice(2), 'hex');
    const iv = crypto.randomBytes(16);

    // Simulate threshold obfuscation using AES-256-GCM so it actually compiles and runs
    // without throwing Node.js RSA padding errors.
    const cipher = crypto.createCipheriv('aes-256-gcm', MOCK_BTX_SYMMETRIC_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(txBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Concatenate IV, AuthTag, and Ciphertext to create the mock BTX payload
    const btxPayload = Buffer.concat([iv, authTag, encrypted]);
    return `0x${btxPayload.toString('hex')}`;
}

export async function submitBtxSettlement(
    dealId: string,
    success: boolean,
    score: number,
    reasoning: string,
    signer: P256Signer, // Hardware authorized the backend, so the backend signs the raw payload!
    operatorWallet: ethers.Wallet,
    escrowContractAddress: string,
    standardRpcUrl: string = "https://testnet-rpc.monad.xyz", // Used to fetch network state
    btxRpcUrl: string = "https://rpc-monad-btx.testnet"       // Used to submit the encrypted tx
) {
    // 1. Connect standard provider to fetch network state (nonce, chainId)
    // staticNetwork: true strictly prevents Ethers from running background loops to detect network changes
    const provider = new ethers.JsonRpcProvider(standardRpcUrl, undefined, { staticNetwork: true });
    const connectedWallet = operatorWallet.connect(provider);

    // Dynamically fetch chainId so this works on Hardhat (31337) and Monad (10143) seamlessly
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    const nonce = await connectedWallet.getNonce();

    // 2. Generate the P256 signature WITH the Domain Separator!
    const { r, s } = signer.signVerdict(
        chainId,
        escrowContractAddress,
        dealId,
        success,
        score,
        reasoning
    );

    // 3. Prepare the transaction data for resolveEscrow
    const abi = [
        "function resolveEscrow(bytes32 dealId, bool success, uint8 score, string calldata reasoning, bytes32 r, bytes32 s) external"
    ];
    const contract = new ethers.Contract(escrowContractAddress, abi, connectedWallet);
    const txData = await contract.resolveEscrow.populateTransaction(
        dealId, success, score, reasoning, r, s
    );

    // Fetch dynamic fee data from the network
    const feeData = await provider.getFeeData();

    // 4. Sign the transaction with the operator's ECDSA wallet (for gas)
    const signedTx = await connectedWallet.signTransaction({
        ...txData,
        nonce: nonce,
        gasLimit: 3000000n, // Bumped to 3M gas to handle heavy ERC-8004 array string writes
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        chainId: chainId
    });

    // 5. BTX ENCRYPTION: Locally encrypt the signed transaction payload BEFORE broadcast
    console.log("Locally encrypting transaction payload with Monad BTX Threshold Key...");
    const ciphertext = encryptForBtx(signedTx);

    // 6. Broadcast to the specialized BTX RPC endpoint
    console.log("Submitting encrypted payload to Monad BTX RPC...");
    const btxRpcProvider = new ethers.JsonRpcProvider(btxRpcUrl, undefined, { staticNetwork: true });

    try {
        const response = await btxRpcProvider.send("eth_sendBtxTransaction", [ciphertext]);
        console.log(`BTX Transaction submitted successfully. Hash: ${response}`);

        // Stop Ethers v6 background polling loops entirely
        provider.destroy();
        btxRpcProvider.destroy();

        return response;
    } catch (error) {
        console.warn("BTX RPC submission failed. Falling back to standard RPC for local testing...");
        // Fallback to standard broadcast so local tests actually execute on-chain
        const txResponse = await provider.broadcastTransaction(signedTx);
        await txResponse.wait(1); // Wait for exactly 1 confirmation
        console.log(`Standard Transaction submitted successfully. Hash: ${txResponse.hash}`);

        // Stop Ethers v6 background polling loops entirely
        provider.destroy();
        btxRpcProvider.destroy();

        return txResponse.hash;
    }
}