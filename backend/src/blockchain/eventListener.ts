import { provider, escrowContract, wallet, CONTRACT_ADDRESS } from './contractClient.js';
import { processDealSettlement, processedDealsInSession } from '../services/escrowManager.js';

const POLL_INTERVAL_MS = 4000;
const MAX_BLOCKS_PER_QUERY = 10;

// ---------------------------------------------------------------------------
// 3. RESILIENT POLLING RECONCILER (Survives Restarts & Dropped Connections)
// ---------------------------------------------------------------------------
export async function startResilientOracle() {
    console.log(`📡 Arbiter Oracle Active. Address: ${wallet.address}`);
    console.log(`🔗 Target Contract: ${CONTRACT_ADDRESS}`);

    // Track cursor block height
    let latestBlock = await provider.getBlockNumber();
    // Look back 20 blocks on startup to catch any missed events during server downtime
    let lastProcessedBlock = Math.max(0, latestBlock - 20);

    console.log(`🔄 Reconciling blocks starting from #${lastProcessedBlock}...`);

    const poll = async () => {
        try {
            const currentBlock = await provider.getBlockNumber();

            if (currentBlock > lastProcessedBlock) {
                const fromBlock = lastProcessedBlock + 1;
                const toBlock = Math.min(currentBlock, fromBlock + MAX_BLOCKS_PER_QUERY);

                // Fetch logs using native typed contract filter
                const filter = escrowContract.filters.DeliverableSubmitted();
                const events = await escrowContract.queryFilter(filter, fromBlock, toBlock);

                for (const event of events) {
                    // Type assertion for EventLog
                    if ('args' in event) {
                        const dealId = event.args[0];
                        const deliverableHash = event.args[1];
                        await processDealSettlement(dealId, deliverableHash);
                    }
                }

                lastProcessedBlock = toBlock;
            }
        } catch (error) {
            console.warn(`⚠️ RPC temporary polling error (retrying in ${POLL_INTERVAL_MS}ms):`, (error as Error).message);
        }

        setTimeout(poll, POLL_INTERVAL_MS);
    };

    // Periodically clear the memory cache to prevent leaks (every 1 hour)
    setInterval(() => {
        processedDealsInSession.clear();
    }, 60 * 60 * 1000);

    // Begin loop
    poll();
}
