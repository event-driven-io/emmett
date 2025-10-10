# When Events Arrive Out of Order: A Pragmatic Guide to Read Models

Your fraud detection system just flagged a payment as high-risk. The only problem? That payment doesn't exist yet in your system. The fraud alert arrived thirty milliseconds before the payment creation event, and now your carefully designed event-sourced aggregate is throwing exceptions because you're trying to apply a fraud score to a non-existent payment.

Your bank runs verification checks simultaneously: fraud detection, credit history, spending limits, merchant validation. Payment processors call these "simultaneous verification protocols" because parallel processing is faster than sequential checks.

This parallel processing creates a coordination problem.

Ordering is preserved within a service's event stream—events for the same payment follow sequence when published to the same partition or topic. Ordering breaks when coordinating across services. Your fraud service publishes to one topic, the payment gateway to another, risk assessment to a third. These independent streams arrive interleaved. Network delays, retry logic, and clock drift scramble the sequence further. Some transports like SQS or Google Pub/Sub only provide "best effort" ordering even within a topic.

You can try to force ordering through message brokers, sequence numbers, or complex choreography. But coordination across distributed systems requires exponential message exchanges. Three servers need 3 message exchanges; 100 servers need 4,950. The performance penalty grows quickly, and perfect ordering across independent services isn't achievable.

So what do you do when you need to build reliable systems on unreliable ordering?

Read models store events as they arrive, regardless of order. Each event updates the fields it knows about.

## The Problem with Perfect Order

Event Sourcing replays events in order to rebuild state. When `FraudScoreCalculated` arrives before `PaymentInitiated`, you can't apply the fraud score. The payment doesn't exist. Your business logic throws null reference exceptions.

Cross-service coordination breaks ordering guarantees. Each service publishes to its own topic. Messages from different topics have no ordering relationship. Even within a service, some patterns create ordering issues: outbox implementations that delete processed messages, RabbitMQ with multiple consumers racing for messages, transports that prioritize throughput over strict ordering.

The payment gateway sends your system a `PaymentInitiated` event. Your system triggers verification services. Fraud analysis finishes in milliseconds. Risk assessment queries credit bureaus. Merchant checks call external APIs. Results arrive scrambled: fraud score before payment creation, approval before risk assessment.

## Read Models for Unordered Events

The read model stores whatever data arrives. FraudScoreCalculated creates a record with fraud data. PaymentInitiated adds payment details to the existing record. Make decisions with available data.

## Payment Orchestration: When Order Breaks Down

A payment orchestration system coordinates verification services. External gateways send payment events. Internal services calculate fraud scores, check limits, assess risk.

```typescript
type PaymentOrchestrationEvent =
  | { type: 'PaymentInitiated'; data: { paymentId: string; amount: number; currency: string; gatewayId: string; initiatedAt: Date } }
  | { type: 'FraudScoreCalculated'; data: { paymentId: string; score: number; riskLevel: 'low' | 'medium' | 'high'; calculatedAt: Date } }
  | { type: 'RiskAssessmentCompleted'; data: { paymentId: string; riskScore: number; factors: string[]; assessedAt: Date } }
  | { type: 'MerchantLimitsChecked'; data: { paymentId: string; withinLimits: boolean; dailyRemaining: number; checkedAt: Date } }
  | { type: 'PaymentApproved'; data: { paymentId: string; approvedBy: string; approvedAt: Date } }
  | { type: 'PaymentDeclined'; data: { paymentId: string; reason: string; declinedAt: Date } };
```

Events should arrive in sequence: initiation, then verifications, then approval. They don't:

```
10:15:32.123 - FraudScoreCalculated (score: 85, high risk)
10:15:32.145 - PaymentInitiated (amount: $500)
10:15:32.167 - PaymentApproved (approved by automated system)
10:15:32.201 - RiskAssessmentCompleted (risk: medium)
10:15:32.234 - MerchantLimitsChecked (within limits)
```

The fraud system flagged the payment as high-risk before the payment existed. Approval happened before risk assessment completed. Traditional Event Sourcing can't apply events to non-existent aggregates.

## Building a Read Model for Unordered Events

The read model for payment orchestration:

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

## Building the Evolve Function

Payment initiation when other events might have already arrived:

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
  if (view.fraudScore && view.withinLimits !== undefined && !view.approvalDecision) {
    const canApprove = view.riskLevel !== 'high' && view.withinLimits;

    return {
      completionPercentage: completion,
      dataQuality: quality,
      status: canApprove ? 'approved' : 'declined',
      approvalDecision: canApprove ? 'approve' : 'decline',
      decisionReason: canApprove
        ? `Auto-approved: low fraud risk (${view.fraudScore}) and within limits`
        : `Auto-declined: ${view.riskLevel === 'high' ? 'high fraud risk' : 'limit exceeded'}`,
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

If you require the payment aggregate to exist first, you can't process the fraud score. The read model stores it anyway:

```typescript
// Fraud score arrives first
{ type: 'FraudScoreCalculated', data: { paymentId: 'pay_123', score: 85, riskLevel: 'high', calculatedAt: new Date() } }

// Creates initial view with fraud data but no payment details
{
  paymentId: 'pay_123',
  fraudScore: 85,
  riskLevel: 'high',
  fraudAssessedAt: '2024-01-15T10:15:32Z',
  status: 'declined',  // High fraud risk auto-declines
  approvalDecision: 'decline',
  decisionReason: 'High fraud risk detected: score 85',
  amount: undefined,   // Still unknown
  currency: undefined,
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
  approvalDecision: 'approve',
  riskScore: 87,                   // New risk data recorded
  riskFactors: ['velocity_spike', 'unusual_location'],
  dataQuality: 'complete',         // All data now available
  decisionReason: 'Approved by automated system (risk assessment completed post-approval)'
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
  approvalDecision: 'decline',
  decisionReason: 'Insufficient funds',
  amount: undefined,          // Payment details unknown
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
  if (existing.fraudAssessedAt && event.calculatedAt <= existing.fraudAssessedAt) {
    return existing;  // Ignore older/duplicate data
  }
  // ... update with newer data
}
```

## The Ingress Pattern: Clean Internal Events

Downstream systems need reliable event streams. They shouldn't deal with out-of-order chaos.

External events arrive unordered from systems you don't control: `PaymentInitiated` from the gateway, `FraudScoreCalculated` from a third-party service, `MerchantLimitsChecked` from your internal API.

The read model collects these, builds state, waits for required data. When verification completes, publish clean internal events.

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

## Business Operations

Don't trigger operations in the evolve function:

```typescript
case 'PaymentApproved': {
  const updated = /* ... */;

  // ❌ Don't do this
  await notificationService.sendApprovalEmail(updated.paymentId);
  await fulfillmentService.startProcessing(updated.paymentId);

  return updated;
}
```

The evolve function builds state. Downstream systems subscribe to clean internal events (`PaymentVerified`, `PaymentVerificationFailed`) and trigger operations independently.

## The Emmett Implementation

`pongoSingleStreamProjection` connects the evolve function to PostgreSQL:

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
        { riskLevel: 'high', status: 'approved' },     // High risk but approved
        { dataQuality: 'partial', status: 'processing' }, // Incomplete data
        { fraudScore: { $gte: 75 }, status: 'approved' }  // High fraud score but approved
      ]
    })
    .toArray();
};
```

Query the collection for dashboards:

```typescript
// Real-time payment dashboard
const dashboard = {
  totalPayments: await getPaymentsByStatus(db, 'approved').length,
  pendingReview: await getPaymentsRequiringReview(db),
  recentDeclines: await getPaymentsByStatus(db, 'declined')
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

Build read models that store partial data. Make decisions with available information. Publish clean events when verification completes.