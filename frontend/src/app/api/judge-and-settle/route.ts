/**
 * =============================================================================
 * `POST /api/judge-and-settle` — the settlement proxy  (Requirement 11.6)
 * =============================================================================
 *
 * THE REASON THIS ROUTE EXISTS IS THE KEY. Settling a deal requires an internal
 * credential the backend checks. A browser must never hold that credential, so a
 * browser must never call the backend's settling endpoint directly — it calls
 * this, and this attaches the key server-side and forwards.
 *
 * FOUR THINGS ENFORCE THAT, at four different layers:
 *
 *   `ENDPOINTS.judgeAndSettle` is `pinned: true, origin: 'local'`, asserted at
 *     COMPILE TIME in `services/endpoints.ts`, so no environment variable can
 *     redirect this call at a real backend and no client can be pointed past the
 *     proxy.
 *   `lib/serverEnv.ts` carries `import 'server-only'`, so importing it from a
 *     client component fails the build.
 *   `check-copy.mjs` allows the variable's identifier at one site under `src/`.
 *   `check-bundle.mjs` greps every emitted client chunk for the identifier and,
 *     when it is set at build time, for the literal value.
 *
 * A MISSING KEY IS A 401 THAT NAMES THE VARIABLE, not a generic refusal. A
 * deployment without the credential can judge but cannot settle, which is a
 * perfectly sensible way to run this demo — every read-only screen works and the
 * sandbox's judge-only path works. Saying only "unauthorized" would send a
 * reviewer reading source to find out why; naming the variable is the difference
 * between a dead end and an instruction. `INTERNAL_KEY_VARIABLE` supplies the name
 * so the copy and the read share one spelling.
 *
 * WITHOUT A CONFIGURED BACKEND THERE IS NOTHING TO FORWARD TO, and this route says
 * so rather than fabricating a settlement. It could mint a plausible transaction
 * hash and return a 200 — that is precisely the kind of invented fact the whole
 * interface is built to avoid. A fabricated settlement receipt would flow into the
 * verify panel's on-chain column and produce a three-way "match" against nothing.
 */

import { failure } from '@/app/api/mockApi';
import { INTERNAL_KEY_VARIABLE, serverEnv } from '@/lib/serverEnv';
import { env } from '@/lib/env';
import { isJudgeRequest, isNonZeroHex32 } from '@/lib/guards';


export const dynamic = 'force-dynamic';

/** The backend path this proxy forwards to, when a backend is configured. */
const UPSTREAM_PATH = '/api/judge-and-settle';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return failure(400, 'The request body is not valid JSON.');
  }

  // Shape-checked before the key is read, so a malformed request gets a 400 rather
  // than a 401 — the sender should be told what is wrong with what they sent, not
  // about a credential they have no control over.
  if (!isJudgeRequest(body)) {
    return failure(
      400,
      'Invalid input. Expected dealId, acceptanceCriteria[], deliverable, and deadline.',
    );
  }

  // Stricter than the judging route, because this path reaches the contract: the
  // escrow rejects anything that is not 32 bytes of non-zero hex with
  // `InvalidDealId`. Catching it here names the input instead of surfacing a
  // revert reason for a request that never had a chance.
  if (!isNonZeroHex32(body.dealId)) {
    return failure(
      400,
      'dealId must be 32 bytes of non-zero hex. Settlement reaches the contract, which rejects any other form.',
      'dealId',
    );
  }

  const key = serverEnv.internalKey;
  if (key === null) {
    return failure(
      401,
      `This deployment holds no settlement authorization, so nothing was judged and nothing was settled. Set ${INTERNAL_KEY_VARIABLE} on the server to enable the settling path. The judge-only path needs no credential and works without it.`,
    );
  }

  const base = env.apiBase?.trim();
  if (!base) {
    // A key with no backend to send it to. Reported as an upstream gap rather
    // than as a fabricated success.
    return failure(
      502,
      'A settlement credential is configured but no backend origin is. Settlement is relayed to the backend, which this deployment cannot reach. Set NEXT_PUBLIC_API_BASE to the backend origin.',
    );
  }

  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}${UPSTREAM_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The one place this value is attached to anything. It is read on the
        // server, in this process, and never serialised into a response.
        'x-internal-key': key,
        },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    // Relayed verbatim, status and all. The backend knows what it did, and
    // paraphrasing its settlement receipt or its revert reason here would put a
    // second author between the contract and the reader.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store, max-age=0, must-revalidate',
      },
    });
  } catch {
    return failure(
      502,
      'The backend did not answer the settlement request. The failure is upstream of this interface and upstream of the contract, so neither needs debugging.',
    );
  }
}
