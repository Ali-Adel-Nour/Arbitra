# ⚖️ Arbitra V2: The Hardware-Backed AI Oracle & Escrow Protocol

> **A production-ready AI Escrow Protocol utilizing Monad's EIP-7951 P256 Precompile, WebAuthn Hardware Enclaves, and BTX MEV Protection.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Network: Monad Testnet](https://img.shields.io/badge/Network-Monad%20Testnet-836EF9?logo=monad)](https://monad.xyz)
[![Security: WebAuthn](https://img.shields.io/badge/Security-WebAuthn%20Passkeys-4CAF50?logo=fidoalliance)](https://fidoalliance.org/)
[![M8ven Score](https://m8ven.ai/badge/mcp/ali-adel-nour-arbitra-v2-6h7d4u)](https://m8ven.ai/mcp/ali-adel-nour-arbitra-v2-6h7d4u)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity&logoColor=white)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14%2B-black?logo=next.js)](https://nextjs.org/)

Arbitra V2 is a massive architectural upgrade to the original Arbitra protocol. It transitions from a purely trust-minimized backend oracle to a **Hardware-Backed, MEV-Protected AI Settlement Engine**. 

By leveraging Monad's high-performance parallel execution and the **EIP-7951 P256 Precompile**, Arbitra V2 completely removes the risk of compromised backend operator keys by requiring a cryptographic signature from a physical hardware secure enclave (like an Android phone or YubiKey) before *any* AI verdict is finalized on-chain.

---
## 🌍 Live Monad Testnet Deployments
| Contract | Address | Explorer |
|----------|---------|----------|
| **ArbiterEscrowV2** | `0x03853a2d66a1701132dc54Ea5d21eD9a6DCA9bD8` | [View on Monad Explorer](https://testnet.monadexplorer.com/contracts/full_match/10143/0x03853a2d66a1701132dc54Ea5d21eD9a6DCA9bD8/) |
| **MockERC20** | `0xA1D47BdB088C1FaD087b20B90D0Da63EDc638E91` | [View on Monad Explorer](https://testnet.monadexplorer.com/address/0xA1D47BdB088C1FaD087b20B90D0Da63EDc638E91) |
| **Registry (Mock)** | `0x9756a48F595BCAafc0B0C2Fb1a01033EaF0Da486` | [View on Monad Explorer](https://testnet.monadexplorer.com/contracts/full_match/10143/0x9756a48F595BCAafc0B0C2Fb1a01033EaF0Da486/) |
---

## 🧭 The Hardware-Backed Architecture

```mermaid
sequenceDiagram
    participant B as Buyer (Next.js)
    participant SC as ArbiterEscrowV2
    participant O as Oracle UI
    participant AI as AI Judge (Backend)
    participant H as Hardware Enclave (Android)
    participant BTX as BTX Mempool
    
    B->>SC: 1. createEscrow(dealId, funds, criteria)
    Note over B,SC: Criteria stored in Event Logs to save Gas!
    B-->>O: 2. Passes Transaction Hash
    
    O->>SC: 3. Fetch logs from Tx Receipt
    SC-->>O: Returns Acceptance Criteria
    
    O->>AI: 4. POST /api/judge (AI Evaluation)
    AI-->>O: Returns Verdict & Score
    
    O->>H: 5. navigator.credentials.get()
    Note over O,H: Cross-device WebAuthn Prompt
    H-->>O: 6. Returns P256 Passkey Signature
    
    O->>AI: 7. POST /api/settle (Signature + Verdict)
    Note over AI: Verifies Hardware Signature
    AI->>AI: 8. Encrypt Payload for BTX
    AI->>BTX: 9. Broadcast Encrypted Tx (MEV Protected)
    
    BTX->>SC: 10. Decrypt & Execute resolveEscrow()
    SC->>SC: 11. EIP-7951 P256 Signature Verification
    SC-->>B: Releases or Refunds Tokens
```

---

## 🎯 What's New in V2?

### 1. 📱 WebAuthn Passkeys & The P256 Precompile
In V1, if the backend server was compromised, the attacker could use the hot wallet private key to drain escrows. 
In V2, the Smart Contract requires a **secp256r1 (P256)** signature natively verified on-chain via Monad's EIP-7951 precompile. The Oracle backend **cannot** broadcast a settlement without a live biometric signature from the Admin's Android Secure Enclave.

### 2. 🛡️ BTX (Blockaid Transaction) MEV Protection
AI Oracle settlements are prime targets for front-running. V2 implements a threshold-encryption architecture. The backend locally encrypts the signed transaction payload before submitting it to the BTX mempool. The transaction remains completely obfuscated until it is proposed in a block, guaranteeing MEV protection.

### 3. ⛽ Gas-Optimized Event Storage
Strings are expensive to store on-chain. V2 completely refactored the `ArbiterEscrowV2` contract to omit the `acceptanceCriteria` from the struct state. Instead, it is emitted in the `EscrowCreated` event log. The Oracle Dashboard dynamically parses the Transaction Receipt logs to retrieve the criteria, achieving a trustless architecture with near-zero storage costs.

### 4. 🎨 Next.js Dashboard
A brand new, dark-themed, highly polished Next.js frontend built with Tailwind CSS, Framer Motion, and Ethers v6. It features split `Buyer` and `Oracle` interfaces specifically designed for seamless hackathon demonstrations.

---

## Why V2? (Architecture Shift)

### 1. Eliminating the "Hot Wallet" Risk (Hardware Security)
* **The V1 Flaw:** The backend server held the Oracle's private key. A server compromise allowed attackers to sign arbitrary verdicts and drain escrow funds.
* **The V2 Solution:** The backend holds zero signing authority over escrow releases. `ArbiterEscrowV2.sol` leverages **Monad's EIP-7951 P256 Precompile** (`0x0100`) to verify signatures on-chain. Even if the server is compromised, funds cannot move without biometric authorization from the admin's physical Secure Enclave (Android Titan M / WebAuthn).

### 2. Zero-Storage Gas Optimization (Event Log Architecture)
* **The V1 Flaw:** Storing long `acceptanceCriteria` strings in contract state consumed significant gas during deployment.
* **The V2 Solution:** Criteria is completely omitted from state storage and emitted via the `EscrowCreated` event log. The Oracle dashboard fetches criteria directly from the transaction receipt logs, ensuring immutable data availability at minimal gas cost.

### 3. MEV Protection (Monad BTX Mempool)
* **The V1 Flaw:** Broadcasting settlement transactions to the public mempool exposed outcomes to front-running and state manipulation.
* **The V2 Solution:** Settlements are encrypted locally before submission to Monad's BTX threshold-encryption mempool, keeping payloads hidden until block inclusion.

---

## 🔐 The Smart Contract Security Model

The `ArbiterEscrowV2.sol` contract enforces strict cryptographic boundaries:

```solidity
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

// 2. Verify Hardware Passkey Signature using Monad's EIP-7951 Precompile
bytes memory input = abi.encodePacked(payloadHash, r, s, oraclePubKeyX, oraclePubKeyY);
(bool callSuccess, bytes memory returnData) = address(0x0100).staticcall(input);
require(callSuccess && abi.decode(returnData, (uint256)) == 1, "Invalid Hardware Signature");
```

---

## 🚀 To Run The Project

Want to run the full flow locally? 

### Prerequisites
- Node.js 20+
- A WebAuthn-capable device (Desktop Chrome with Windows Hello/TouchID, or Android via cross-device QR code).

### 1. Start the Environment
We use `concurrently` to run both the frontend and backend with a single command!

```bash
# Install dependencies in all folders
npm install
cd frontend && npm install
cd ../backend && npm instal
cd ..

# Run both the Next.js Frontend and the Node.js Backend concurrently
npm run dev:all

```
### 2. The Buyer Flow
1. Open your **Desktop Chrome Browser** to `http://localhost:3001/buyer`.
2. Connect MetaMask (Automatically switches to Monad Testnet).
3. Fill out the form and click **Deploy & Fund Escrow**.
4. Approve the two transactions.
5. Click **Copy Transaction Hash**.

### 3. The Oracle Flow
1. Open a new tab to `http://localhost:3001/oracle`.
2. Click **Register Hardware**. Select *"Use a phone or tablet"* in the Chrome popup to scan a QR code and register your Android device as the secure enclave.
3. Paste the **Transaction Hash** you copied from the Buyer. The UI will instantly fetch and lock the Acceptance Criteria from the blockchain logs!
4. Click **Run AI Evaluation**.
5. Click **Hardware Sign & Broadcast**. Chrome will prompt you for your biometric fingerprint. Once authorized, the backend encrypts the payload and settles the deal on Monad!

---

## 🧰 V2 Tech Stack

- **Network:** Monad Testnet
- **Smart Contracts:** Solidity 0.8.20 + Hardhat
- **Frontend:** Next.js App Router, Tailwind CSS, Framer Motion, Lucide Icons
- **Web3 Interaction:** Ethers.js v6
- **Cryptography:** `@simplewebauthn/browser` & `@simplewebauthn/server` for COSE/CBOR parsing, AES-256-GCM for BTX mempool encryption mock.
- **AI Integration:** Google Gemini / OpenAI via custom backend orchestration.
