"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { Loader2, ShieldCheck, Fingerprint, Database, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { motion } from "framer-motion";

export default function OracleDashboard() {
  const [txHashInput, setTxHashInput] = useState("");
  const [dealId, setDealId] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [criteria, setCriteria] = useState("");
  const [isCriteriaLocked, setIsCriteriaLocked] = useState(false);
  const [isFetchingCriteria, setIsFetchingCriteria] = useState(false);
  const [verdict, setVerdict] = useState<any>(null);
  
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  
  const [isJudging, setIsJudging] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  
  const [settlementHash, setSettlementHash] = useState<string | null>(null);

  const getApiUrl = () => {
    return typeof window !== "undefined" 
      ? `http://${window.location.hostname}:3000` 
      : "http://localhost:3000";
  };

  // Auto-fetch criteria when a valid Tx Hash is entered
  useEffect(() => {
    if (txHashInput && txHashInput.length === 66 && txHashInput.startsWith("0x")) {
      fetchDealFromTx(txHashInput);
    } else {
      setIsCriteriaLocked(false);
      setCriteria("");
      setDealId("");
    }
  }, [txHashInput]);

  const fetchDealFromTx = async (hash: string) => {
    try {
      setIsFetchingCriteria(true);
      const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://testnet-rpc.monad.xyz");
      const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS || "";
      const abi = ["event EscrowCreated(bytes32 indexed dealId, address indexed buyer, address indexed seller, address token, uint256 amount, uint256 deadline, string acceptanceCriteria)"];
      
      const contract = new ethers.Contract(escrowAddress, abi, provider);
      
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) {
        for (const log of receipt.logs) {
          try {
            const parsed = contract.interface.parseLog(log);
            if (parsed && parsed.name === "EscrowCreated") {
              setDealId(parsed.args.dealId);
              setCriteria(parsed.args.acceptanceCriteria);
              setIsCriteriaLocked(true);
              return;
            }
          } catch (err) {
            // Log doesn't match ABI, ignore
          }
        }
      }
      setIsCriteriaLocked(false);
      setCriteria("");
      setDealId("");
    } catch (e) {
      console.error("Failed to fetch deal from tx:", e);
      setIsCriteriaLocked(false);
    } finally {
      setIsFetchingCriteria(false);
    }
  };
  
  // 1. Register Hardware Passkey
  const registerHardware = async () => {
    try {
      setIsRegistering(true);
      const resp = await fetch(`${getApiUrl()}/api/webauthn/register-options`);
      const options = await resp.json();
      
      const attResp = await startRegistration({ optionsJSON: options });
      
      const verifyResp = await fetch(`${getApiUrl()}/api/webauthn/register-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attResp),
      });
      
      const verifyData = await verifyResp.json();
      if (verifyData.verified) setIsRegistered(true);
    } catch (e) {
      console.error(e);
      alert("Registration failed. Ensure you are on localhost or HTTPS.");
    } finally {
      setIsRegistering(false);
    }
  };

  // 2. Judge Deliverable
  const runJudge = async () => {
    try {
      setIsJudging(true);
      const resp = await fetch(`${getApiUrl()}/api/judge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, deliverable, acceptanceCriteria: criteria }),
      });
      const data = await resp.json();
      setVerdict(data);
    } catch (e) {
      console.error(e);
      alert("AI Evaluation failed");
    } finally {
      setIsJudging(false);
    }
  };

  // 3. Hardware Authorize & Settle
  const settleDeal = async () => {
    try {
      setIsSettling(true);
      
      // Get authentication options (challenge) from backend
      const authOptsResp = await fetch(`${getApiUrl()}/api/webauthn/auth-options`);
      const options = await authOptsResp.json();
      
      // Trigger Android Phone WebAuthn
      const asseResp = await startAuthentication({ optionsJSON: options });
      
      // Send WebAuthn signature + verdict to backend to broadcast
      const settleResp = await fetch(`${getApiUrl()}/api/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId,
          success: verdict.success,
          score: verdict.score,
          reasoning: verdict.reasoning,
          webAuthnResponse: asseResp,
        }),
      });
      
      const data = await settleResp.json();
      if (data.txHash) {
        setSettlementHash(data.txHash);
      }
    } catch (e) {
      console.error(e);
      alert("Hardware Authorization failed");
    } finally {
      setIsSettling(false);
    }
  };

  return (
    <div className="min-h-screen p-8 md:p-16 max-w-5xl mx-auto space-y-12">
      <header className="space-y-4">
        <h1 className="text-display gradient-heading tracking-tight">Oracle Operations</h1>
        <p className="text-meta text-muted max-w-2xl">
          Hardware-backed AI Escrow settlement interface. Requires WebAuthn Admin registration before executing on-chain settlements.
        </p>
      </header>

      {/* Hardware Registration Module */}
      <motion.section 
        className="bg-panel-1 border border-panel-edge rounded-[12px] p-6 space-y-4"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 border-b border-rule pb-4">
          <ShieldCheck className="w-5 h-5 text-accent-text" />
          <h2 className="text-heading">1. Enclave Registration</h2>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-body text-muted">Link your Android Hardware Secure Enclave to authorize BTX broadcasts.</p>
          <button
            onClick={registerHardware}
            disabled={isRegistered || isRegistering}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-hi text-record font-medium rounded-[8px] hover:bg-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
            {isRegistered ? "Enclave Registered" : "Register Hardware"}
          </button>
        </div>
      </motion.section>

      {/* AI Judge Module */}
      <motion.section 
        className="bg-panel-1 border border-panel-edge rounded-[12px] p-6 space-y-6"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-3 border-b border-rule pb-4">
          <Database className="w-5 h-5 text-accent-text" />
          <h2 className="text-heading">2. Evaluate Deliverable</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider flex items-center justify-between">
                Transaction Hash
                {dealId && <span className="text-[10px] text-accent">ID: {dealId.slice(0,6)}...{dealId.slice(-4)}</span>}
              </label>
              <input 
                type="text" 
                className="w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none"
                placeholder="0x..."
                value={txHashInput}
                onChange={(e) => setTxHashInput(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider flex items-center justify-between">
                Acceptance Criteria
                {isFetchingCriteria && <Loader2 className="w-3 h-3 animate-spin" />}
                {isCriteriaLocked && (
                  <span className="flex items-center gap-1 text-state-paid text-[10px]">
                    <Lock className="w-3 h-3" /> ON-CHAIN VERIFIED
                  </span>
                )}
              </label>
              <textarea 
                className={`w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none min-h-[100px] ${isCriteriaLocked ? 'opacity-80 bg-panel-2' : ''}`}
                placeholder="Describe what the freelancer must do..."
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                readOnly={isCriteriaLocked}
              />
            </div>
            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider block">Freelancer Deliverable</label>
              <textarea 
                className="w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none min-h-[100px]"
                placeholder="Submitted work..."
                value={deliverable}
                onChange={(e) => setDeliverable(e.target.value)}
              />
            </div>
            <button
              onClick={runJudge}
              disabled={isJudging || !dealId || !deliverable}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-panel-2 border border-rule text-hi text-record font-medium rounded-[8px] hover:bg-well transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isJudging ? <Loader2 className="w-4 h-4 animate-spin" /> : "Run AI Evaluation"}
            </button>
          </div>

          {/* AI Verdict Result Box */}
          <div className="bg-well border border-rule rounded-[8px] p-6 flex flex-col justify-between">
            {!verdict ? (
              <div className="flex flex-col items-center justify-center h-full text-muted space-y-4">
                <Database className="w-8 h-8 opacity-50" />
                <p className="text-meta">Awaiting AI Evaluation</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h3 className="text-caption text-muted uppercase tracking-wider mb-2 rule-derived">Verdict</h3>
                  <div className={`text-display ${verdict.success ? "text-state-paid" : "text-state-tampered"}`}>
                    {verdict.success ? "ACCEPTED" : "REJECTED"}
                  </div>
                </div>
                <div>
                  <h3 className="text-caption text-muted uppercase tracking-wider mb-2 rule-hashed">Quality Score</h3>
                  <div className="text-heading text-hi">{verdict.score} / 100</div>
                </div>
                <div>
                  <h3 className="text-caption text-muted uppercase tracking-wider mb-2 rule-hashed">Reasoning</h3>
                  <p className="text-body text-primary">{verdict.reasoning}</p>
                </div>

                <div className="pt-4 border-t border-rule">
                  <button
                    onClick={settleDeal}
                    disabled={isSettling || !isRegistered}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-ruling-ground text-ruling-ink border border-accent text-record font-medium rounded-[8px] hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                  >
                    {isSettling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Fingerprint className="w-4 h-4" />
                        Hardware Sign & Broadcast
                      </>
                    )}
                  </button>
                  {!isRegistered && (
                    <p className="text-meta text-state-deliberating mt-3 flex items-center gap-2">
                      <AlertTriangle className="w-3 h-3" />
                      Must register hardware before signing
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.section>

      {/* Settlement Result */}
      {settlementHash && (
        <motion.section 
          className="bg-state-paid-ground border border-state-paid rounded-[12px] p-6"
          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        >
          <div className="flex items-start gap-4">
            <CheckCircle2 className="w-6 h-6 text-state-paid mt-1" />
            <div className="space-y-2">
              <h2 className="text-heading text-state-paid">Settlement Broadcast Successful</h2>
              <p className="text-body text-primary">The transaction was locally encrypted and relayed to the Monad BTX Mempool.</p>
              <div className="bg-well border border-rule rounded p-3 mt-4 overflow-x-auto">
                <code className="text-record text-hi">{settlementHash}</code>
              </div>
            </div>
          </div>
        </motion.section>
      )}
    </div>
  );
}
