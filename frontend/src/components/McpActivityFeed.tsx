'use client';

/**
 * =============================================================================
 * `McpActivityFeed` — reputation lookups, as a continuous transcript
 * =============================================================================
 *
 * ONE WELL, NO SEPARATORS. Every line sits in a single recessed ground with
 * nothing between them — no rule, no radius, no alternating stripe. That is
 * `LogLine`'s whole treatment and the reason it exists as a distinct container
 * kind: consecutive queries are separate EVENTS in one stream, not fields of one
 * record, and a rule between them would claim a boundary that is not there. The
 * contrast with `DocketEntry`, which does carry `rule/instance` because each row
 * there really is a separate record, is the vocabulary doing work.
 *
 * NO SEPARATE HOOK. `usePolling(getMcpActivity)` is the whole data layer: there is
 * nothing to derive, nothing to group, nothing to memoise. Wrapping it in a
 * `useActivity` hook would add a file whose entire body is a pass-through, and the
 * indirection would suggest a derivation that does not exist.
 *
 * EVERY VALUE ON A LINE IS LABELLED. A joined string — agent, arrow, agent, figure,
 * decision — reads compactly and is exactly what Requirement 14.11 forbids: no
 * part of it is individually labelled or addressable, and a reader cannot tell the
 * returned figure from the agent identifiers. So each line is a description list
 * with visible terms, and it wraps rather than truncating at narrow widths.
 *
 * THE FIGURE IS SHOWN AS RETURNED, NOT RECOMPUTED. `McpActivityEntry` records the
 * reliability the querying agent actually received, and recomputing it here would
 * answer today's question about yesterday's lookup — the decision on that line was
 * made against the number in it, and replacing that number would break the one
 * claim the screen makes.
 */

import { ACTIVITY } from '@/content/copy';
import { errorCopy } from '@/lib/errorCopy';
import { formatRate } from '@/lib/format';
import { usePolling } from '@/hooks/usePolling';
import { getMcpActivity } from '@/services/api';
import { EmptyState } from '@/components/primitives/EmptyState';
import { ErrorState } from '@/components/primitives/ErrorState';
import { LogLine } from '@/components/primitives/LogLine';
import { MachineValue } from '@/components/primitives/MachineValue';
import { Panel } from '@/components/primitives/Panel';
import type { HiringDecision } from '@/types';

/**
 * The ink for each decision.
 *
 * `declined` is BLUE, not red. A buyer walking away from a low-reliability seller
 * is the protocol working as designed — it is the outcome the demo is proudest of.
 * Red in this application means one thing only: a hash that fails its own
 * recomputation. `queried-only` is muted because no decision was recorded, which is
 * an absence rather than an outcome.
 */
const DECISION_INK: Record<HiringDecision, string> = {
  hired: 'text-state-paid',
  declined: 'text-state-refunded',
  'queried-only': 'text-muted',
};

/**
 * A labelled term on one line. Inline, so a line wraps as a unit.
 *
 * Spacing between the label and its value is a margin on the label, not a flex
 * `gap` on this wrapper. `gap` on an `inline-flex` container was rendering as
 * zero in production, which read as "ASKEDagent-b" with no space at all —
 * the label and the value fused into one unreadable word. A margin is the
 * boring, reliable choice here on purpose: it cannot silently collapse the
 * way the gap did.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="mr-6 mb-1 inline-block whitespace-nowrap last:mr-0">
      <span className="text-caption text-muted uppercase mr-3">
        {label}
      </span>
      {" "}
      <span className="relative z-10">
        {children}
      </span>
    </span>
  );
}
export function McpActivityFeed() {
  const { data, error, lastUpdatedAt, refetch } = usePolling(getMcpActivity);

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-5">
        <h1 className="text-display text-hi max-w-[24ch]">{ACTIVITY.heading}</h1>
        <p className="text-lede text-muted max-w-[62ch]">{ACTIVITY.lede}</p>
      </header>

      {/* Above the rows, never instead of them: a failed poll leaves the last
          transcript on screen. */}
      {error === null ? null : (
        <ErrorState
          cause={errorCopy(error).cause}
          recovery={errorCopy(error).recovery}
          onRetry={refetch}
          retryLabel="Request the activity feed again"
        />
      )}

      <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="activity-heading" className="text-heading text-hi">
            {ACTIVITY.feedHeading}
          </h2>
          {/* Both notes before the first line, because both change how a line
              should be read. */}
          <p className="text-meta text-muted max-w-[68ch]">{ACTIVITY.provenanceNote}</p>
          <p className="text-meta text-muted max-w-[68ch]">{ACTIVITY.decisionNote}</p>
          <p className="text-meta text-muted max-w-[68ch]">{ACTIVITY.sourceNote}</p>
        </div>

        <Panel title={ACTIVITY.feedHeading} count={entries.length}>
          {entries.length === 0 ? (
            <EmptyState condition={lastUpdatedAt === null ? ACTIVITY.loading : ACTIVITY.empty} />
          ) : (
            // The shared well. One ground, every line inside it, nothing between.
            <div className="bg-well flex flex-col py-2">
              {entries.map((entry) => (
                <LogLine key={entry.id} timestamp={entry.timestamp}>
                  {/* `flex-wrap` with a `gap` on the parent is the same pattern
                      that fused the label and its value inside `Field` — margins
                      on each `Field` do the separating instead, so the space
                      cannot be lost to the same collapse. */}
                  <div className="flex flex-wrap items-baseline">
                    <Field label={ACTIVITY.labels.querying}>
                      <MachineValue value={entry.queryingAgent} label="querying agent" />
                    </Field>

                    <Field label={ACTIVITY.labels.queried}>
                      <MachineValue value={entry.queriedAgent} label="queried agent" />
                    </Field>

                    <Field label={ACTIVITY.labels.reliability}>
                      <span className="text-hi tabular-nums">
                        {formatRate(entry.returnedReliability)}
                      </span>
                    </Field>

                    <Field label={ACTIVITY.labels.decision}>
                      {/* Words first, ink second. */}
                      <span className={DECISION_INK[entry.decision]}>
                        {ACTIVITY.decisions[entry.decision]}
                      </span>
                    </Field>

                    <Field label={ACTIVITY.labels.source}>
                      <span className="text-muted">{ACTIVITY.sources[entry.source]}</span>
                    </Field>
                  </div>
                </LogLine>
              ))}
            </div>
          )}
        </Panel>

        {lastUpdatedAt === null ? null : (
          <p aria-live="polite" className="text-meta text-muted">
            Updated {new Date(lastUpdatedAt).toISOString().slice(11, 19)} UTC
          </p>
        )}
      </section>
    </div>
  );
}
