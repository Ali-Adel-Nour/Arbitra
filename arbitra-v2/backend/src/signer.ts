import * as crypto from 'crypto';
import { ethers } from 'ethers';

export class P256Signer {
    private privateKey: crypto.KeyObject;
    public publicKey: crypto.KeyObject;

    /**
     * @param privateKeyPem Optional. If provided, loads an existing key. 
     * If empty, generates a fresh one (useful for the initial setup script).
     */
    constructor(privateKeyPem?: string) {
        if (privateKeyPem) {
            this.privateKey = crypto.createPrivateKey(privateKeyPem);
            this.publicKey = crypto.createPublicKey(this.privateKey);
        } else {
            const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
                namedCurve: 'prime256v1'
            });
            this.privateKey = privateKey;
            this.publicKey = publicKey;
        }
    }

    /**
     * Get the uncompressed public key coordinates (x, y) for the smart contract constructor.
     */
    public getCoordinates(): { x: string, y: string } {
        const rawPub = this.publicKey.export({ format: 'jwk' });
        
        const xHex = Buffer.from(rawPub.x!, 'base64url').toString('hex').padStart(64, '0');
        const yHex = Buffer.from(rawPub.y!, 'base64url').toString('hex').padStart(64, '0');
        
        return {
            x: `0x${xHex}`,
            y: `0x${yHex}`
        };
    }

    /**
     * Exports the private key so you can save it to your .env file after generating it once.
     */
    public exportPrivateKey(): string {
        return this.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    }

    /**
     * Reconstructs the raw payload exactly as the smart contract does with standard abi.encode.
     */
    private buildRawPayload(
        chainId: number, 
        contractAddress: string, 
        dealId: string, 
        success: boolean, 
        score: number, 
        reasoning: string
    ): Buffer {
        // 1. Hash the dynamic string EXACTLY like the smart contract: keccak256(bytes(reasoning))
        const hashedReasoning = ethers.keccak256(ethers.toUtf8Bytes(reasoning));

        // 2. Use standard AbiCoder (matches abi.encode) instead of solidityPacked
        const abiCoder = new ethers.AbiCoder();
        const encodedHex = abiCoder.encode(
            ['uint256', 'address', 'bytes32', 'bool', 'uint8', 'bytes32'],
            [chainId, contractAddress, dealId, success, score, hashedReasoning]
        );
        
        // Convert '0x...' hex string to Buffer
        return Buffer.from(encodedHex.slice(2), 'hex');
    }

    /**
     * Signs the AI Court verdict and returns the r and s components for the EIP-7951 precompile.
     */
    public signVerdict(
        chainId: number, 
        contractAddress: string, 
        dealId: string, 
        success: boolean, 
        score: number, 
        reasoning: string
    ): { r: string, s: string } {
        // Build the Domain-Separated payload
        const rawPayload = this.buildRawPayload(chainId, contractAddress, dealId, success, score, reasoning);

        // crypto.sign('sha256') automatically hashes the rawPayload using SHA-256 before signing.
        // This perfectly matches the smart contract's `sha256(abi.encode(...))`
        const signatureP1363 = crypto.sign('sha256', rawPayload, {
            key: this.privateKey,
            dsaEncoding: 'ieee-p1363'
        });

        const r = signatureP1363.subarray(0, 32).toString('hex');
        const s = signatureP1363.subarray(32, 64).toString('hex');

        return {
            r: `0x${r}`,
            s: `0x${s}`
        };
    }
}