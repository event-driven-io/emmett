# When Events Arrive Out of Order: A Pragmatic Guide to Read Models

Business processes run in parallel. When you process a payment, fraud checking, risk assessment, and merchant validation happen simultaneously. That's efficient business, not a flaw.

These parallel processes involve different systems communicating through message queues. Your fraud service publishes to one queue. Risk assessment to another. The payment gateway to a third. Messages arrive in the order they were received by your system, not the order they were created. Your fraud detection service flags a high-risk payment at 10:00:01. The payment initiation event from the gateway, created at 10:00:00, arrives at 10:00:02. The fraud score arrives before the payment exists in your system.

This happens with RabbitMQ when you have multiple consumers racing for messages. It happens with SQS which only guarantees best-effort ordering. It happens when your outbox pattern deletes processed messages and loses sequence. It happens when network delays shuffle carefully ordered streams. A colleague recently struggled with this exact problem - events from external systems arriving through multiple queues, out of order due to race conditions between modules.

When you store these events as they arrive in your event store, you read them back in the order they were appended, not the order they were created. The business process happened in one sequence. Your event store records a different sequence. Your code tries to update a payment that doesn't exist yet. It fails.

## Why Naive Solutions Don't Work

You might think sorting by timestamp solves this. It doesn't. Clock skew between services means timestamps lie. Network delays mean creation time and arrival time diverge. My colleague tried this approach. Events still arrived scrambled, and rebuilding projections failed.

Waiting for all events blocks your system. What if the risk assessment service is down? Do you hold the payment for minutes? Hours? What defines "all events" when services can fail, retry, or send duplicates?

Rejecting out-of-order events loses data. Your fraud service diligently calculates a high-risk score. You reject it because the payment doesn't exist yet. Five milliseconds later the payment arrives, gets approved, and you've lost critical risk information.

## How Traditional Approaches Break

Event Sourcing assumes you can rebuild state by replaying events in sequence. When `FraudScoreCalculated` arrives before `PaymentInitiated`, the payment doesn't exist. You can't apply a fraud score to nothing. Your carefully designed domain model throws exceptions.

This isn't specific to Event Sourcing. Even if you just update read models directly from events, you have the same problem. Your read model update handler for `FraudScoreCalculated` looks for a payment document to update. No document exists. The update fails.

### Understanding Event Stores and Read Models

An event store is a database that stores events. Events arrive from your message broker, get appended to the store. The store preserves the order events were appended, not the order they were created.

Read models are documents or tables built from those events. A projection processes each event and updates documents. In PostgreSQL, it's a table with payment data. In MongoDB, it's a document collection. The projection is the function that transforms events into document updates.

Traditional projections assume events arrive in business order. They fail when that assumption breaks.

## The Right Solution You Often Can't Use

The proper fix is topology design. Use predictable identifiers to route related events to the same partition. Ensure ordering at the infrastructure level. I've written about this in ["Predictable Identifiers: Enabling Proper Partitioning and Ordering in Event-Driven Systems"](https://www.architecture-weekly.com/p/predictable-identifiers-enabling).

But you often can't fix topology. External systems publish events their way, not yours. Other teams own their messaging patterns. Legacy integrations constrain your options. Organizational boundaries limit your influence.

Physics also fights you. Network partitions happen. Services fail independently. The coordination overhead grows exponentially - 3 servers need 3 message exchanges, 100 servers need 4,950. Perfect ordering across distributed systems isn't achievable at scale. I covered this in ["The Order of Things: Why You Can't Cheat Physics in Distributed Systems"](https://www.architecture-weekly.com/p/the-order-of-things-why-you-cant).

Sometimes you've got to do what you've got to do. When you can't control the messaging topology, you need to handle the chaos on your side.

## The Pragmatic Solution: Read Models as Anti-Corruption Layer

My colleague's events were arriving out of order from external systems. I advised him: Don't try to sort them. Store data as it arrives and "denoise" on your side. Treat external events as "rumors" - interpret them and save your own "facts". Use an Anti-Corruption Layer pattern to protect from external chaos.

Read models excel at this. A read model document can have partial state - optional fields that get filled as events arrive. The evolve function processes each event, updating whatever fields it can, ignoring what it can't, making decisions with available data.

Read models act as an Anti-Corruption Layer. They accept events in any order and build consistent state from them.

## Payment Orchestration Example

A payment orchestration system shows this pattern in action. External gateways send payment events. Internal services calculate fraud scores, check limits, assess risk.

```typescript
type PaymentOrchestrationEvent =
  | { type: 'PaymentInitiated'; data: { paymentId: string; amount: number; currency: string; gatewayId: string; initiatedAt: Date } }
  | { type: 'FraudScoreCalculated'; data: { paymentId: string; score: number; riskLevel: 'low' | 'medium' | 'high'; calculatedAt: Date } }
  | { type: 'RiskAssessmentCompleted'; data: { paymentId: string; riskScore: number; factors: string[]; assessedAt: Date } }
  | { type: 'MerchantLimitsChecked'; data: { paymentId: string; withinLimits: boolean; dailyRemaining: number; checkedAt: Date } }
  | { type: 'PaymentApproved'; data: { paymentId: string; approvedBy: string; approvedAt: Date } }
  | { type: 'PaymentDeclined'; data: { paymentId: string; reason: string; declinedAt: Date } };
```

Events from these services race through your message queues:

```
10:15:32.123 - FraudScoreCalculated (score: 85, high risk)
10:15:32.145 - PaymentInitiated (amount: $500)
10:15:32.167 - PaymentApproved (approved by automated system)
10:15:32.201 - RiskAssessmentCompleted (risk: medium)
10:15:32.234 - MerchantLimitsChecked (within limits)
```

The fraud system flagged the payment as high-risk before the payment existed in your system. Approval happened before risk assessment completed. Traditional handlers can't process events for non-existent payments. They fail to find documents to update.

## Building a Read Model That Handles Chaos

A read model is a document in your database. Each document represents a payment's verification state. The document has optional fields because you don't know which event arrives first. The evolve function processes each event and updates this document, creating it if necessary.

```typescript
type Payment = {
  amount: number;
  currency: string;
  gatewayId: string;
  initiatedAt: Date;
};

type FraudAssessment = {
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  assessedAt: Date;
};

type RiskEvaluation = {
  score: number;
  factors: string[];
  assessedAt: Date;
};

type MerchantLimits = {
  withinLimits: boolean;
  dailyRemaining: number;
  checkedAt: Date;
};

type Decision = {
  approval: 'approve' | 'decline';
  reason: string;
  decidedAt: Date;
};

type PaymentVerification = {
  paymentId: string;
  payment?: Payment;
  fraudAssessment?: FraudAssessment;
  riskEvaluation?: RiskEvaluation;
  merchantLimits?: MerchantLimits;
  decision?: Decision;
  status: 'unknown' | 'processing' | 'approved' | 'declined';
  completionPercentage: number;
  lastUpdated: Date;
  dataQuality: 'partial' | 'sufficient' | 'complete';
};
```

## The Evolve Function: Processing Events in Any Order

The evolve function is a projection. It takes the current document (might be null if no events arrived yet) and an incoming event, then returns the updated document.

Payment initiation when fraud scoring might have already completed:

```typescript
const evolve = (
  current: PaymentVerification | null,
  { type, data: event }: PaymentOrchestrationEvent
): PaymentVerification | null => {
  switch (type) {
    case 'PaymentInitiated': {
      const existing = current ?? { paymentId: event.paymentId, status: 'unknown' as const, completionPercentage: 0, lastUpdated: new Date(), dataQuality: 'partial' as const };

      return {
        ...existing,
        payment: {
          amount: event.amount,
          currency: event.currency,
          gatewayId: event.gatewayId,
          initiatedAt: event.initiatedAt,
        },
        lastUpdated: event.initiatedAt,
      };
    }
  }
};
```

If fraud scoring completed first, `current` already has fraud data. The handler merges payment details into existing state.

Fraud scoring might arrive first:

```typescript
case 'FraudScoreCalculated': {
  const existing = current ?? { paymentId: event.paymentId, status: 'unknown' as const, completionPercentage: 0, lastUpdated: new Date(), dataQuality: 'partial' as const };

  if (existing.fraudAssessment && event.calculatedAt <= existing.fraudAssessment.assessedAt) {
    return existing;
  }

  const fraudAssessment: FraudAssessment = {
    score: event.score,
    riskLevel: event.riskLevel,
    assessedAt: event.calculatedAt,
  };

  if (event.riskLevel === 'high') {
    return {
      ...existing,
      fraudAssessment,
      status: 'declined',
      decision: {
        approval: 'decline',
        reason: `High fraud risk detected: score ${event.score}`,
        decidedAt: event.calculatedAt,
      },
      lastUpdated: event.calculatedAt,
    };
  }

  return {
    ...existing,
    fraudAssessment,
    lastUpdated: event.calculatedAt,
  };
}
```

The timestamp check prevents retrograde updates from retries. Payment approval might conflict with fraud data:

```typescript
case 'PaymentApproved': {
  const existing = current ?? { paymentId: event.paymentId, status: 'unknown' as const, completionPercentage: 0, lastUpdated: new Date(), dataQuality: 'partial' as const };

  if (existing.fraudAssessment?.riskLevel === 'high') {
    return {
      ...existing,
      decision: {
        approval: 'decline',
        reason: `Approval attempted but overridden by fraud (score: ${existing.fraudAssessment.score})`,
        decidedAt: event.approvedAt,
      },
      lastUpdated: event.approvedAt,
    };
  }

  return {
    ...existing,
    status: 'approved',
    decision: {
      approval: 'approve',
      reason: `Approved by ${event.approvedBy}`,
      decidedAt: event.approvedAt,
    },
    lastUpdated: event.approvedAt,
  };
}
```

## Waiting for Dependencies

Some decisions need multiple pieces. The `MerchantLimitsChecked` handler waits for both fraud assessment and merchant limits:

```typescript
case 'MerchantLimitsChecked': {
  const existing = current ?? { paymentId: event.paymentId, status: 'unknown' as const, completionPercentage: 0, lastUpdated: new Date(), dataQuality: 'partial' as const };

  const merchantLimits: MerchantLimits = {
    withinLimits: event.withinLimits,
    dailyRemaining: event.dailyRemaining,
    checkedAt: event.checkedAt,
  };

  const updated = {
    ...existing,
    merchantLimits,
    lastUpdated: event.checkedAt,
  };

  // Check if we now have BOTH critical pieces
  if (updated.fraudAssessment && updated.merchantLimits) {
    // Both present - can make final decision
    if (updated.fraudAssessment.riskLevel === 'high') {
      return {
        ...updated,
        status: 'declined',
        decision: {
          approval: 'decline',
          reason: 'High fraud risk',
          decidedAt: event.checkedAt,
        },
      };
    }

    if (!updated.merchantLimits.withinLimits) {
      return {
        ...updated,
        status: 'declined',
        decision: {
          approval: 'decline',
          reason: 'Exceeds merchant limits',
          decidedAt: event.checkedAt,
        },
      };
    }

    // Both checks pass - approve
    return {
      ...updated,
      status: 'approved',
      decision: {
        approval: 'approve',
        reason: 'Verified',
        decidedAt: event.checkedAt,
      },
    };
  }

  // Don't have both yet - stay in processing
  return {
    ...updated,
    status: 'processing',
  };
}
```

Helper functions calculate completion and data quality:

```typescript
const recalculateStatus = (view: PaymentVerification): Partial<PaymentVerification> => {
  const completion = calculateCompletionPercentage(view);
  const quality = determineDataQuality(view);

  // Can make decisions with partial data if critical factors are present
  if (view.fraudAssessment?.score && view.merchantLimits?.withinLimits !== undefined && !view.decision) {
    const canApprove = view.fraudAssessment.riskLevel !== 'high' && view.merchantLimits.withinLimits;

    return {
      completionPercentage: completion,
      dataQuality: quality,
      status: canApprove ? 'approved' : 'declined',
      decision: {
        approval: canApprove ? 'approve' : 'decline',
        reason: canApprove
          ? `Auto-approved: low fraud risk (${view.fraudAssessment.score}) and within limits`
          : `Auto-declined: ${view.fraudAssessment.riskLevel === 'high' ? 'high fraud risk' : 'limit exceeded'}`,
        decidedAt: new Date()
      }
    };
  }

  return {
    completionPercentage: completion,
    dataQuality: quality,
    status: completion > 0.7 ? 'processing' : 'unknown',
  };
};

const calculateCompletionPercentage = (view: PaymentVerification): number => {
  const factors = [
    view.payment !== undefined,
    view.fraudAssessment !== undefined,
    view.riskEvaluation !== undefined,
    view.merchantLimits !== undefined,
  ];

  return factors.filter(Boolean).length / factors.length;
};

const determineDataQuality = (view: PaymentVerification): 'partial' | 'sufficient' | 'complete' => {
  const completion = calculateCompletionPercentage(view);

  if (completion === 1.0) return 'complete';
  if (completion >= 0.6) return 'sufficient';
  return 'partial';
};
```

## Handling the Edge Cases

### Case 1: The Missing Foundation

Your fraud service processes a payment and sends `FraudScoreCalculated`. The `PaymentInitiated` event never arrives - stuck in a queue or the external gateway is having issues.

Traditional approaches require the payment to exist first. They can't process the fraud score. The evolve function creates a document with the fraud data:

```typescript
// Fraud score arrives first
{ type: 'FraudScoreCalculated', data: { paymentId: 'pay_123', score: 85, riskLevel: 'high', calculatedAt: new Date() } }

// Creates initial document with fraud data but no payment details
{
  paymentId: 'pay_123',
  fraudAssessment: {
    score: 85,
    riskLevel: 'high',
    assessedAt: '2024-01-15T10:15:32Z'
  },
  status: 'declined',  // High fraud risk auto-declines
  decision: {
    approval: 'decline',
    reason: 'High fraud risk detected: score 85',
    decidedAt: '2024-01-15T10:15:32Z'
  },
  payment: undefined,   // Still unknown
  completionPercentage: 0.25,
  dataQuality: 'partial'
}
```

High fraud scores decline the payment. Payment details might arrive later or never.

### Case 2: The Late Override

A payment gets approved, then risk assessment completes and flags serious concerns:

```typescript
// Sequence: Approve first, then risk assessment
PaymentApproved → RiskAssessmentCompleted (high risk factors)

// Read model result:
{
  paymentId: 'pay_456',
  status: 'approved',              // Decision stands
  decision: {
    approval: 'approve',
    reason: 'Approved by automated system (risk assessment completed post-approval)',
    decidedAt: '2024-01-15T10:15:32Z'
  },
  riskEvaluation: {
    score: 87,
    factors: ['velocity_spike', 'unusual_location'],
    assessedAt: '2024-01-15T10:15:33Z'
  },
  dataQuality: 'complete',         // All data now available
}
```

The approval stands. Flag it for review based on the late-arriving risk data.

### Case 3: The Ending Before Beginning

A payment gets declined by an external service before your system knows the payment exists:

```typescript
// PaymentDeclined arrives first
{ type: 'PaymentDeclined', data: { paymentId: 'pay_789', reason: 'Insufficient funds', declinedAt: new Date() } }

// Result:
{
  paymentId: 'pay_789',
  status: 'declined',
  decision: {
    approval: 'decline',
    reason: 'Insufficient funds',
    decidedAt: '2024-01-15T10:15:32Z'
  },
  payment: undefined,          // Payment details unknown
  completionPercentage: 0.25,
  dataQuality: 'partial'
}
```

### Case 4: The Retry Storm

Network issues cause services to retry operations, creating duplicate events with slight timestamp variations:

```typescript
// Multiple fraud scores from retries
FraudScoreCalculated (score: 85, calculatedAt: 10:15:32.123)
FraudScoreCalculated (score: 85, calculatedAt: 10:15:32.456)  // Retry
FraudScoreCalculated (score: 87, calculatedAt: 10:15:33.001)  // Updated score
```

The evolve function only accepts newer fraud data:

```typescript
case 'FraudScoreCalculated': {
  // Only update if this is newer fraud data
  if (existing.fraudAssessment?.assessedAt && event.calculatedAt <= existing.fraudAssessment.assessedAt) {
    return existing;  // Ignore older/duplicate data
  }
  // ... update with newer data
}
```

## The Ingress Pattern: Clean Internal Events

Downstream systems need reliable event streams. They shouldn't deal with out-of-order chaos.

External events arrive unordered from systems you don't control: `PaymentInitiated` from the gateway, `FraudScoreCalculated` from a third-party service, `MerchantLimitsChecked` from your internal API.

The projection processes these events, builds state from whatever arrives, waits for required data. When verification completes, publish clean internal events.

The evolve function returns events to publish:

```typescript
const evolve = async (
  current: PaymentVerification | null,
  event: ReadEvent<PaymentOrchestrationEvent>,
  context: PongoProjectionHandlerContext
): Promise<PaymentVerification | { document: PaymentVerification; events: VerificationEvent[] } | null> => {
  // ... build updated state ...

  const updated = { /* ... updated verification state ... */ };

  // Check if verification just became complete
  const wasIncomplete = !current?.fraudAssessment || !current?.merchantLimits;
  const nowComplete = updated.fraudAssessment && updated.merchantLimits;

  if (wasIncomplete && nowComplete) {
    // We just got the last piece - publish clean internal event
    if (updated.fraudAssessment.riskLevel === 'high') {
      return {
        document: updated,
        events: [{
          type: 'PaymentVerificationFailed',
          data: {
            paymentId: updated.paymentId,
            reason: 'High fraud risk',
            fraudScore: updated.fraudAssessment.score,
            verifiedAt: new Date(),
          },
        }],
      };
    }

    if (updated.merchantLimits.withinLimits) {
      return {
        document: updated,
        events: [{
          type: 'PaymentVerified',
          data: {
            paymentId: updated.paymentId,
            amount: updated.payment!.amount,
            currency: updated.payment!.currency,
            fraudScore: updated.fraudAssessment.score,
            verifiedAt: new Date(),
          },
        }],
      };
    }
  }

  return updated;
};
```

The framework appends events to the event store in the same transaction as the document update. Downstream systems subscribe to `PaymentVerified` and `PaymentVerificationFailed` - clean events published exactly once.

These internal events are based on your complete verification logic, not individual claims from external systems.

## Preventing Duplicate Internal Events

The same event might arrive twice due to retries. The fraud service sends `FraudScoreCalculated`, then retries seconds later. If this completes verification (both fraud and limits now exist), you don't want duplicate `PaymentVerified` events.

```typescript
const wasIncomplete = !current?.fraudAssessment || !current?.merchantLimits;
const nowComplete = updated.fraudAssessment && updated.merchantLimits;

if (wasIncomplete && nowComplete) {
  // Only publish when transitioning from incomplete to complete
  return { document: updated, events: [/* ... */] };
}
```

The first event that completes verification publishes. The retry finds both pieces already existed, returns the updated document without publishing events.

## Business Operations and Anti-Patterns

Read models maintain state. Business operations happen elsewhere. Don't trigger side effects in the evolve function:

```typescript
case 'PaymentApproved': {
  const updated = /* ... */;

  // ❌ Don't do this
  await notificationService.sendApprovalEmail(updated.paymentId);
  await fulfillmentService.startProcessing(updated.paymentId);

  return updated;
}
```

The evolve function builds state. Each event updates the document with whatever information it carries. Downstream systems subscribe to clean internal events (`PaymentVerified`, `PaymentVerificationFailed`) and trigger operations independently.

Side effects in projections create problems. If the projection fails after sending an email but before saving the document, you send duplicate emails on retry. If multiple instances process the same event stream, you trigger operations multiple times. Keep projections pure - they transform events into state, nothing more.

## The Emmett Implementation

`pongoSingleStreamProjection` creates a projection that maintains one document per payment ID. Events with the same payment ID update the same document:

```typescript
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

export const paymentVerificationProjection = pongoSingleStreamProjection({
  collectionName: 'paymentVerification',
  evolve,
  canHandle: [
    'PaymentInitiated',
    'FraudScoreCalculated',
    'RiskAssessmentCompleted',
    'MerchantLimitsChecked',
    'PaymentApproved',
    'PaymentDeclined',
  ],
});

// Query interface for dashboards and APIs
export const getPaymentStatus = async (
  db: PongoDb,
  paymentId: string
): Promise<PaymentVerification | null> => {
  return db
    .collection<PaymentVerification>('paymentVerification')
    .findOne({ _id: paymentId });
};

export const getPaymentsByStatus = async (
  db: PongoDb,
  status: 'unknown' | 'processing' | 'approved' | 'declined'
): Promise<PaymentVerification[]> => {
  return db
    .collection<PaymentVerification>('paymentVerification')
    .find({ status })
    .toArray();
};

export const getPaymentsRequiringReview = async (
  db: PongoDb
): Promise<PaymentVerification[]> => {
  return db
    .collection<PaymentVerification>('paymentVerification')
    .find({
      $or: [
        { 'fraudAssessment.riskLevel': 'high', status: 'approved' },     // High risk but approved
        { dataQuality: 'partial', status: 'processing' }, // Incomplete data
        { 'fraudAssessment.score': { $gte: 75 }, status: 'approved' }  // High fraud score but approved
      ]
    })
    .toArray();
};
```

Query the collection for dashboards:

```typescript
// Real-time payment dashboard
const dashboard = {
  totalPayments: (await getPaymentsByStatus(db, 'approved')).length,
  pendingReview: await getPaymentsRequiringReview(db),
  recentDeclines: (await getPaymentsByStatus(db, 'declined'))
    .filter(p => p.lastUpdated > yesterday),
  dataQualityIssues: await db.collection('paymentVerification')
    .find({ dataQuality: 'partial' })
    .toArray(),
};
```

## When This Approach Works (And When It Doesn't)

This approach works when:

**Your business logic can handle partial data**: Payment approval can often proceed with fraud score and limits check, even if risk assessment is pending. E-commerce fulfillment can start when payment is confirmed, even if recommendation engine results are still processing.

**Eventual consistency is acceptable**: The payment dashboard might show "processing" for a few hundred milliseconds while verification completes. Most business users can tolerate brief inconsistency in exchange for system responsiveness.

**Decisions can be corrected or refined**: A payment approved with partial data can be flagged for additional review when complete risk data arrives. An order can be expedited or delayed based on complete customer analysis.

**You have clear business rules for conflicts**: When fraud assessment contradicts approval, fraud wins. When risk assessment arrives late, it updates data quality but doesn't reverse committed decisions.

This approach struggles when:

**Perfect consistency is required**: Financial accounting, legal compliance, and safety-critical systems often can't tolerate any inconsistency, even briefly.

**Business logic requires complete data**: Some decisions genuinely can't be made with partial information. Credit limit increases might require complete financial analysis before any approval.

**Rollback costs are high**: If reversing a decision is expensive or impossible, you need stronger ordering guarantees before committing.

**Users can't tolerate uncertainty**: Some interfaces need to show definitive status immediately, not "processing" or "partial data available."

## Conclusion: Embracing the Chaos

My colleague struggled with events arriving out of order from external systems. He tried sorting by timestamp. He tried waiting for all events. Nothing worked reliably.

The solution was to stop fighting the chaos. External events are rumors about what happened in other systems. Your read model documents store the facts you derive from those rumors. The evolve function processes whatever arrives, in whatever order, building state incrementally.

This isn't a workaround. It's an acknowledgment that distributed systems don't guarantee order across boundaries. When you can't control the topology, you adapt on your side. Store data as it arrives. Denoise in your projections. Create clean internal events for downstream systems.

Sometimes the proper solution is fixing your message topology. Route related events to the same partition. Use predictable identifiers for correlation. But when external systems constrain your options, when organizational boundaries limit your control, when legacy integrations force your hand - you've got to do what you've got to do.

Build read models where documents handle partial state. Process events in any order. Make decisions with available data. That's how you build reliable systems on unreliable foundations.