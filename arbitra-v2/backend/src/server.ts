import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import { judgeDeliverable, processDealSettlement } from "./escrowManager";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------
// WebAuthn Admin Configuration (Hackathon Demo)
// ---------------------------------------------------------
const rpName = "Arbitra V2 Oracle Admin";
const rpID = "localhost";
const expectedOrigin = "http://localhost:3001";

// In-memory store for the hackathon demo
let currentChallenge: string | undefined;
let registeredAuthenticator: any | undefined;

// Endpoint to start registering the Android hardware passkey
app.get("/api/webauthn/register-options", async (req, res) => {
    try {
        const options = await generateRegistrationOptions({
            rpName,
            rpID,
            userName: "oracle-admin",
            attestationType: "none",
            authenticatorSelection: {
                userVerification: "required",
                residentKey: "required",
            },
        });
        currentChallenge = options.challenge;
        res.json(options);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to verify the Android hardware passkey registration
app.post("/api/webauthn/register-verify", async (req, res) => {
    const { body } = req;
    if (!currentChallenge) return res.status(400).json({ error: "No active challenge" });

    try {
        const verification = await verifyRegistrationResponse({
            response: body,
            expectedChallenge: currentChallenge,
            expectedOrigin,
            expectedRPID: rpID,
        });

        if (verification.verified && verification.registrationInfo) {
            registeredAuthenticator = verification.registrationInfo.credential;
            console.log("✅ Admin Hardware Passkey Registered!");
            res.json({ verified: true });
        } else {
            res.status(400).json({ error: "Hardware verification failed" });
        }
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Endpoint to trigger the Hardware Authorization signature
app.get("/api/webauthn/auth-options", async (req, res) => {
    if (!registeredAuthenticator) {
        return res.status(400).json({ error: "No hardware wallet registered yet." });
    }

    try {
        const options = await generateAuthenticationOptions({
            rpID,
            allowCredentials: [
                {
                    id: registeredAuthenticator.id,
                },
            ],
            userVerification: "required",
        });
        currentChallenge = options.challenge;
        res.json(options);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------
// BTX Relay & Escrow Core API
// ---------------------------------------------------------

// ROUTE 1: Evaluate Deliverable (NO SIGNING OR BROADCASTING)
app.post("/api/judge", async (req, res) => {
    try {
        const { dealId, deliverable, acceptanceCriteria } = req.body;

        if (!dealId || !deliverable || !acceptanceCriteria) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        console.log(`\n========================================`);
        console.log(`⚖️ Received AI Evaluation request for deal: ${dealId}`);
        console.log(`========================================`);

        const verdict = await judgeDeliverable(dealId, deliverable, acceptanceCriteria);
        res.status(200).json(verdict);
    } catch (error: any) {
        console.error(`Error in /api/judge:`, error.message);
        res.status(500).json({ error: error.message || "An error occurred during evaluation." });
    }
});

// ROUTE 2: BTX Relay (Verifies Hardware, Constructs TX, Encrypts, Broadcasts)
app.post("/api/settle", async (req, res) => {
    try {
        const { dealId, success, score, reasoning, webAuthnResponse } = req.body;

        if (!dealId || typeof success !== "boolean" || typeof score !== "number" || !reasoning || !webAuthnResponse) {
            return res.status(400).json({ error: "Missing required fields or WebAuthn response." });
        }

        if (!currentChallenge || !registeredAuthenticator) {
            return res.status(400).json({ error: "Missing challenge or unregistered hardware." });
        }

        console.log(`\n========================================`);
        console.log(`🛡️ Verifying Hardware Authorization for deal: ${dealId}`);
        console.log(`========================================`);

        // 1. Cryptographically verify the WebAuthn signature matches the registered passkey
        const verification = await verifyAuthenticationResponse({
            response: webAuthnResponse,
            expectedChallenge: currentChallenge,
            expectedOrigin,
            expectedRPID: rpID,
            credential: registeredAuthenticator,
        });

        if (!verification.verified) {
            return res.status(403).json({ error: "Hardware authorization signature invalid." });
        }

        console.log(`✅ Hardware Authorization verified successfully.`);
        console.log(`🔐 Oracle Backend is now signing the raw payload...`);

        // 2. Hardware verified, Oracle backend signs the raw payload and broadcasts!
        const result = await processDealSettlement(dealId, success, score, reasoning);

        res.status(200).json(result);
    } catch (error: any) {
        console.error(`Error in /api/settle:`, error.message);
        res.status(500).json({ error: error.message || "An error occurred during BTX settlement." });
    }
});

app.listen(port, () => {
    console.log(`🚀 Arbitra V2 Backend API listening at http://localhost:${port}`);
    console.log(`Endpoints ready: /api/judge & /api/settle`);
});
