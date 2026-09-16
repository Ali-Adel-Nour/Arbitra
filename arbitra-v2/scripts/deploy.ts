import { ethers } from "hardhat";
import * as crypto from "crypto";

async function main() {
    console.log("Starting Arbitra V2 Deployment...\n");

    // 1. Deploy the Mock Registry
    const MockRegistry = await ethers.getContractFactory("MockRegistry");
    const registry = await MockRegistry.deploy();
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log(`✅ MockRegistry deployed to: ${registryAddress}`);

    // 2. Generate a fresh secp256r1 keypair for the AI Oracle
    console.log("\nGenerating AI Oracle P256 Keypair...");
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });

    const rawPub = publicKey.export({ format: 'jwk' });
    const xHex = "0x" + Buffer.from(rawPub.x!, 'base64url').toString('hex').padStart(64, '0');
    const yHex = "0x" + Buffer.from(rawPub.y!, 'base64url').toString('hex').padStart(64, '0');
    
    console.log(`Oracle Public Key X: ${xHex}`);
    console.log(`Oracle Public Key Y: ${yHex}`);

    // 3. Deploy ArbiterEscrowV2
    const ArbiterEscrowV2 = await ethers.getContractFactory("ArbiterEscrowV2");
    const escrow = await ArbiterEscrowV2.deploy(
        registryAddress, // Validation Registry
        registryAddress, // Reputation Registry
        xHex,
        yHex
    );
    await escrow.waitForDeployment();
    const escrowAddress = await escrow.getAddress();
    console.log(`✅ ArbiterEscrowV2 deployed to: ${escrowAddress}`);

    // 4. Output the Oracle Private Key so the user can save it to .env
    const privateKeyPem = privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    console.log("\n========================================================");
    console.log("🔥 SAVE THIS TO YOUR .env AS ORACLE_P256_PRIVATE_KEY 🔥");
    console.log("========================================================");
    console.log(privateKeyPem);
    console.log("========================================================\n");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
