"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Loader2, Wallet, PlusCircle, CheckCircle2, Copy } from "lucide-react";
import { motion } from "framer-motion";

const ESCROW_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ADDRESS || "";
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS || "";

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function balanceOf(address account) external view returns (uint256)"
];

const ESCROW_ABI = [
  "function createEscrow(bytes32 dealId, address freelancer, address token, uint256 amount, uint256 deadline, string calldata acceptanceCriteria) external"
];

export default function BuyerDashboard() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [balance, setBalance] = useState("0");
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  
  const [freelancer, setFreelancer] = useState("");
  const [amount, setAmount] = useState("");
  const [criteria, setCriteria] = useState("");
  
  const [isCreating, setIsCreating] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Connect MetaMask
  const connectWallet = async () => {
    if (typeof window === "undefined" || !(window as any).ethereum) {
      alert("Please install MetaMask to use the Buyer Dashboard.");
      return;
    }
    
    try {
      const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
      
      // Request network switch to Monad Testnet
      const monadChainId = "0x279f"; // 10143
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: monadChainId }],
        });
      } catch (switchError: any) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          try {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: monadChainId,
                  chainName: 'Monad Testnet',
                  rpcUrls: ['https://testnet-rpc.monad.xyz'],
                  nativeCurrency: {
                    name: 'MON',
                    symbol: 'MON',
                    decimals: 18,
                  },
                },
              ],
            });
          } catch (addError) {
            throw new Error("Failed to add Monad Testnet to MetaMask");
          }
        } else {
          throw switchError;
        }
      }

      await browserProvider.send("eth_requestAccounts", []);
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();
      
      setProvider(browserProvider);
      setWallet(address);

      // Fetch Token Balance
      const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const bal = await token.balanceOf(address);
      setBalance(ethers.formatUnits(bal, 18));
      
    } catch (e: any) {
      console.error(e);
      alert("Failed to connect wallet: " + (e.message || "Please ensure you are on Monad Testnet."));
    }
  };

  const createEscrow = async () => {
    if (!provider || !wallet || !freelancer || !amount) return;
    
    try {
      setIsCreating(true);
      const signer = await provider.getSigner();
      
      const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
      const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      
      const parsedAmount = ethers.parseUnits(amount, 18);
      const newDealId = ethers.id(`LIVE_TEST_DEAL_${Date.now()}`);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 7; // 1 week
      
      // 1. Approve Token
      const currentAllowance = await token.allowance(wallet, ESCROW_ADDRESS);
      if (currentAllowance < parsedAmount) {
        console.log("Approving tokens...");
        const txApprove = await token.approve(ESCROW_ADDRESS, parsedAmount);
        await txApprove.wait();
      }
      
      // 2. Create Escrow
      console.log("Creating escrow contract...");
      const txCreate = await escrow.createEscrow(newDealId, freelancer, TOKEN_ADDRESS, parsedAmount, deadline, criteria);
      const receipt = await txCreate.wait();
      
      setTxHash(receipt.hash);
    } catch (e: any) {
      console.error(e);
      alert("Transaction failed: " + (e.message || "Unknown error"));
    } finally {
      setIsCreating(false);
    }
  };

  const copyTxHash = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetForm = () => {
    setTxHash(null);
    setFreelancer("");
    setAmount("");
    setCriteria("");
  };

  return (
    <div className="min-h-screen p-8 md:p-16 max-w-5xl mx-auto space-y-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-4">
          <h1 className="text-display gradient-heading tracking-tight">Buyer Operations</h1>
          <p className="text-meta text-muted max-w-2xl">
            Fund new AI Escrow agreements directly from your Web3 wallet.
          </p>
        </div>
        
        {/* Wallet Connection */}
        <div>
          {!wallet ? (
            <button
              onClick={connectWallet}
              className="flex items-center gap-2 px-5 py-3 bg-panel-2 border border-rule text-hi text-record font-medium rounded-[8px] hover:bg-well transition-colors"
            >
              <Wallet className="w-4 h-4" />
              Connect MetaMask
            </button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 px-4 py-2 bg-well border border-rule rounded-full text-caption">
                <span className="w-2 h-2 rounded-full bg-state-paid"></span>
                {wallet.slice(0, 6)}...{wallet.slice(-4)}
              </div>
              <p className="text-meta text-muted pr-2">{balance} MOCK</p>
            </div>
          )}
        </div>
      </header>

      {/* Creation Module */}
      <motion.section 
        className="bg-panel-1 border border-panel-edge rounded-[12px] p-6 space-y-6"
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      >
        <div className="flex items-center gap-3 border-b border-rule pb-4">
          <PlusCircle className="w-5 h-5 text-accent-text" />
          <h2 className="text-heading">Create Escrow Deal</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider block">Freelancer Address</label>
              <input 
                type="text" 
                className="w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none"
                placeholder="0x..."
                value={freelancer}
                onChange={(e) => setFreelancer(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider block">Amount (MOCK Tokens)</label>
              <input 
                type="number" 
                className="w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none"
                placeholder="50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-caption text-muted uppercase tracking-wider block">Acceptance Criteria</label>
              <textarea 
                className="w-full bg-well border border-rule rounded-[8px] p-3 text-record text-primary focus:border-accent outline-none min-h-[120px]"
                placeholder="What exactly should the freelancer deliver?"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </div>
            
            <button
              onClick={createEscrow}
              disabled={isCreating || !wallet || !freelancer || !amount || !!txHash}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent text-hi text-record font-medium rounded-[8px] hover:bg-blue-500 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : txHash ? "Deal Deployed" : "Deploy & Fund Escrow"}
            </button>
            {!wallet && (
              <p className="text-meta text-state-deliberating text-center">Please connect MetaMask first</p>
            )}
          </div>

          {/* Success Banner / Instructions */}
          <div className="bg-well border border-rule rounded-[8px] p-6 flex flex-col justify-center items-center text-center space-y-4">
            {!txHash ? (
              <div className="text-muted max-w-sm space-y-3">
                <Wallet className="w-10 h-10 opacity-50 mx-auto" />
                <h3 className="text-body font-medium text-primary">Fund the Smart Contract</h3>
                <p className="text-meta">When you click Deploy, you will sign two transactions: an ERC20 Approve, and the Escrow Creation.</p>
              </div>
            ) : (
              <motion.div 
                className="w-full space-y-6"
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              >
                <div className="space-y-2">
                  <CheckCircle2 className="w-12 h-12 text-state-paid mx-auto mb-4" />
                  <h3 className="text-heading text-state-paid">Deal Created!</h3>
                  <p className="text-body text-primary">Your funds are now locked in the Arbiter Escrow V2 smart contract.</p>
                </div>
                
                <div className="bg-panel-1 border border-panel-edge rounded-lg p-4 space-y-3 text-left">
                  <label className="text-caption text-muted uppercase tracking-wider">Transaction Hash</label>
                  <div className="flex items-center gap-2">
                    <code className="text-meta text-hi flex-1 break-all bg-well p-2 rounded border border-rule">
                      {txHash}
                    </code>
                    <button 
                      onClick={copyTxHash}
                      className="p-2 bg-panel-2 border border-rule rounded hover:bg-well transition-colors"
                      title="Copy Transaction Hash"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-state-paid" /> : <Copy className="w-4 h-4 text-primary" />}
                    </button>
                  </div>
                  <p className="text-meta text-muted mt-2">
                    Copy this Transaction Hash and switch to the <strong>Oracle Dashboard</strong> to simulate the final AI Settlement.
                  </p>
                </div>
                
                <button
                  onClick={resetForm}
                  className="w-full py-2 border border-rule text-primary hover:bg-well rounded-[8px] transition-colors mt-2 text-caption font-medium"
                >
                  Create Another Deal
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </motion.section>
    </div>
  );
}
