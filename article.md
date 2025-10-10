# When Events Arrive Out of Order: A Pragmatic Guide to Read Models

Your fraud detection system just flagged a payment as high-risk. The only problem? That payment doesn't exist yet in your system. The fraud alert arrived thirty milliseconds before the payment creation event, and now your carefully designed event-sourced aggregate is throwing exceptions because you're trying to apply a fraud score to a non-existent payment.

Your bank runs verification checks simultaneously: fraud detection, credit history, spending limits, merchant validation. Payment processors call these "simultaneous verification protocols" because parallel processing is faster than sequential checks.

This parallel processing creates a coordination problem.

Ordering is preserved within a service's event stream—events for the same payment follow sequence when published to the same partition or topic. Ordering breaks when coordinating across services. Your fraud service publishes to one topic, the payment gateway to another, risk assessment to a third. These independent streams arrive interleaved. Network delays, retry logic, and clock drift scramble the sequence further. Some transports like SQS or Google Pub/Sub only provide "best effort" ordering even within a topic.

You can try to force ordering through message brokers, sequence numbers, or complex choreography. But coordination across distributed systems requires exponential message exchanges. Three servers need 3 message exchanges; 100 servers need 4,950. The performance penalty grows quickly, and perfect ordering across independent services isn't achievable.

So what do you do when you need to build reliable systems on unreliable ordering?

Read models can handle out-of-order events by building consistent views from inconsistent data streams. This approach accepts that events may arrive out of sequence and designs around that reality.

## The Problem with Perfect Order

Event Sourcing works beautifully when events arrive in sequence. You replay them against your aggregate, each event building on the previous state, until you have a consistent snapshot of what happened.

But Event Sourcing assumes you can rebuild state by replaying events in order. When `FraudScoreCalculated` arrives before `PaymentInitiated`, you have nowhere to apply that fraud score. The aggregate doesn't exist yet. Your business logic fails with null reference exceptions.

Cross-service coordination breaks ordering guarantees. Each service publishes to its own topic. Messages from different topics have no ordering relationship. Even within a service, some patterns create ordering issues: outbox implementations that delete processed messages, RabbitMQ with multiple consumers racing for messages, transports that prioritize throughput over strict ordering.

The payment gateway sends your system a `PaymentInitiated` event. Your system triggers verification services. Fraud analysis finishes in milliseconds. Risk assessment queries credit bureaus. Merchant checks call external APIs. Results arrive scrambled: fraud score before payment creation, approval before risk assessment.

## A Different Approach: Read Models for Unordered Events

Read models change the approach. Instead of trying to enforce order, they accept that events may arrive out of sequence and build consistent views anyway.

Treat incoming events as partial information rather than complete facts. A fraud score arriving before payment creation tells you something about a payment that might exist. Store it, correlate it when the payment arrives, and build decisions from whatever data you have.

## Payment Orchestration: When Order Breaks Down

Imagine you're building a payment orchestration system. External payment gateways send payment events, and you coordinate internal verification services to approve or decline transactions.

Your events might look like this:

```typescript
type PaymentOrchestrationEvent =
  | { type: 'PaymentInitiated'; data: { paymentId: string; amount: number; currency: string; gatewayId: string; initiatedAt: Date } }
  | { type: 'FraudScoreCalculated'; data: { paymentId: string; score: number; riskLevel: 'low' | 'medium' | 'high'; calculatedAt: Date } }
  | { type: 'RiskAssessmentCompleted'; data: { paymentId: string; riskScore: number; factors: string[]; assessedAt: Date } }
  | { type: 'MerchantLimitsChecked'; data: { paymentId: string; withinLimits: boolean; dailyRemaining: number; checkedAt: Date } }
  | { type: 'PaymentApproved'; data: { paymentId: string; approvedBy: string; approvedAt: Date } }
  | { type: 'PaymentDeclined'; data: { paymentId: string; reason: string; declinedAt: Date } };
```

Events should arrive in sequence: initiation, then verifications, then approval. Instead, you get this:

```
10:15:32.123 - FraudScoreCalculated (score: 85, high risk)
10:15:32.145 - PaymentInitiated (amount: $500)
10:15:32.167 - PaymentApproved (approved by automated system)
10:15:32.201 - RiskAssessmentCompleted (risk: medium)
10:15:32.234 - MerchantLimitsChecked (within limits)
```

The fraud system flagged the payment as high-risk before the payment existed. Approval happened before risk assessment completed. Traditional Event Sourcing can't apply events to non-existent aggregates.

## Building a Read Model for Unordered Events

Here's how you might structure a read model for payment orchestration:

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

type PaymentOrchestrationView = {
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


## Understanding Projections and the Evolve Function

Projections build views from event streams. The `evolve` function takes the current state and an incoming event, then returns updated state. Normally, this works like:

```typescript
// Traditional evolve: expects events in order
const evolve = (current: PaymentView, event: PaymentEvent) => {
  switch (event.type) {
    case 'PaymentInitiated':
      return { id: event.paymentId, amount: event.amount, status: 'pending' };
    case 'PaymentApproved':
      return { ...current, status: 'approved' };
  }
};
```

This works when `PaymentApproved` always arrives after `PaymentInitiated`. But events arrive out of order. The evolve function must handle missing context and build useful state anyway.

Start with the simplest case - handling payment initiation:

```typescript
const evolve = (
  current: PaymentOrchestrationView | null,
  { type, data: event }: PaymentOrchestrationEvent
): PaymentOrchestrationView | null => {
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

The key insight: `current` might be `null`, but it might also contain data from events that arrived earlier. If fraud scoring completed before payment initiation, `current` already has fraud data. The payment initiation handler merges payment details into existing state.

This pattern handles the race condition where verification events arrive before the payment exists.

Now add fraud scoring, which might arrive first:

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

The fraud handler makes business decisions with partial data. High fraud risk declines the payment immediately, even without knowing the payment amount or merchant details.

The timestamp check prevents retrograde updates from retries or duplicate events. Only newer fraud scores update the view.

Add payment approval, which might conflict with fraud data:

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

Each handler follows the pattern: check for existing state, apply business logic with available data, return updated state.

Helper functions calculate completion and data quality:

```typescript
const recalculateStatus = (view: PaymentOrchestrationView): Partial<PaymentOrchestrationView> => {
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

const calculateCompletionPercentage = (view: PaymentOrchestrationView): number => {
  const factors = [
    view.payment !== undefined,
    view.fraudAssessment !== undefined,
    view.riskEvaluation !== undefined,
    view.merchantLimits !== undefined,
  ];

  return factors.filter(Boolean).length / factors.length;
};

const determineDataQuality = (view: PaymentOrchestrationView): 'partial' | 'sufficient' | 'complete' => {
  const completion = calculateCompletionPercentage(view);

  if (completion === 1.0) return 'complete';
  if (completion >= 0.6) return 'sufficient';
  return 'partial';
};
```

## Handling the Edge Cases

Real systems have edge cases that simple implementations don't handle. Let's walk through scenarios that break naive approaches.

### Case 1: The Missing Foundation

Your fraud service processes a payment and sends `FraudScoreCalculated`. But the `PaymentInitiated` event never arrives - maybe it's stuck in a queue, maybe the external gateway is having issues.

Traditional Event Sourcing would leave you with an orphaned fraud score and no way to process it. The read model approach handles this:

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

The system can make a decision (decline high-risk payments) even without complete payment details. When `PaymentInitiated` eventually arrives, it fills in the missing data without changing the fraud-based decision.

### Case 2: The Late Override

A payment gets approved by your automated system, then risk assessment completes and flags serious concerns. In Event Sourcing, this creates a conflict - you've already committed to approval but new information suggests you shouldn't have.

The read model handles this by updating data quality but maintaining decision consistency:

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

This gives you options. You might trigger additional review processes, flag the payment for monitoring, or implement business rules about post-approval risk discovery. The read model preserves both the decision timeline and the complete risk picture.

### Case 3: The Ending Before Beginning

Sometimes you receive terminal events before initialization events. A payment might get declined by an external service before your system even knows the payment exists:

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

When `PaymentInitiated` eventually arrives, it adds details but doesn't change the outcome. The payment was already declined by an authoritative external system.

### Case 4: The Retry Storm

Network issues cause services to retry operations, creating duplicate events with slight timestamp variations:

```typescript
// Multiple fraud scores from retries
FraudScoreCalculated (score: 85, calculatedAt: 10:15:32.123)
FraudScoreCalculated (score: 85, calculatedAt: 10:15:32.456)  // Retry
FraudScoreCalculated (score: 87, calculatedAt: 10:15:33.001)  // Updated score
```

The evolve function handles this by only accepting newer fraud data:

```typescript
case 'FraudScoreCalculated': {
  // Only update if this is newer fraud data
  if (existing.fraudAssessedAt && event.calculatedAt <= existing.fraudAssessedAt) {
    return existing;  // Ignore older/duplicate data
  }
  // ... update with newer data
}
```

This prevents retrograde updates while allowing legitimate score improvements.

## Business Operations: When to Act

Read models excel at maintaining state, but business systems need to trigger operations - sending notifications, updating external systems, fulfilling orders. The question is: when and how?

The naive approach triggers operations directly from the evolve function:

```typescript
case 'PaymentApproved': {
  const updated = /* ... update logic ... */;

  // ❌ Anti-pattern: side effects in read model
  await notificationService.sendApprovalEmail(updated.paymentId);
  await fulfillmentService.startProcessing(updated.paymentId);

  return updated;
}
```

This creates problems:

- **Performance**: The evolve function should be fast and predictable
- **Reliability**: Network failures can cause inconsistent state
- **Testing**: Side effects make unit testing complex
- **Separation of concerns**: Read models should model, not operate

A better approach separates state management from business operations. The read model maintains state, and separate processes watch for state changes:

```typescript
const triggerBusinessOperations = (before: PaymentOrchestrationView | null, after: PaymentOrchestrationView) => {
  // Only trigger on state transitions
  if (before?.status !== after.status) {
    switch (after.status) {
      case 'approved':
        if (after.dataQuality === 'sufficient' || after.dataQuality === 'complete') {
          // Queue operations for reliable processing
          operationsQueue.enqueue({
            type: 'PaymentApprovalOperations',
            paymentId: after.paymentId,
            amount: after.amount,
            approvedAt: after.lastUpdated,
          });
        }
        break;

      case 'declined':
        operationsQueue.enqueue({
          type: 'PaymentDeclineOperations',
          paymentId: after.paymentId,
          reason: after.decisionReason,
          declinedAt: after.lastUpdated,
        });
        break;
    }
  }

  // Trigger quality-based operations
  if (before?.dataQuality !== after.dataQuality && after.dataQuality === 'complete') {
    operationsQueue.enqueue({
      type: 'DataCompletionOperations',
      paymentId: after.paymentId,
      finalRisk: after.riskScore,
      completedAt: after.lastUpdated,
    });
  }
};
```

This preserves the separation between state modeling and business operations while ensuring reliable operation execution.

## The Emmett Implementation

Wire the evolve function into Emmett:

```typescript
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';

export const paymentOrchestrationProjection = pongoSingleStreamProjection({
  collectionName: 'paymentOrchestration',
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
): Promise<PaymentOrchestrationView | null> => {
  return db
    .collection<PaymentOrchestrationView>('paymentOrchestration')
    .findOne({ _id: paymentId });
};

export const getPaymentsByStatus = async (
  db: PongoDb,
  status: 'unknown' | 'processing' | 'approved' | 'declined'
): Promise<PaymentOrchestrationView[]> => {
  return db
    .collection<PaymentOrchestrationView>('paymentOrchestration')
    .find({ status })
    .toArray();
};

export const getPaymentsRequiringReview = async (
  db: PongoDb
): Promise<PaymentOrchestrationView[]> => {
  return db
    .collection<PaymentOrchestrationView>('paymentOrchestration')
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

Dashboard queries become straightforward:

```typescript
// Real-time payment dashboard
const dashboard = {
  totalPayments: await getPaymentsByStatus(db, 'approved').length,
  pendingReview: await getPaymentsRequiringReview(db),
  recentDeclines: await getPaymentsByStatus(db, 'declined')
    .filter(p => p.lastUpdated > yesterday),
  dataQualityIssues: await db.collection('paymentOrchestration')
    .find({ dataQuality: 'partial' })
    .toArray(),
};
```

## When This Approach Works (And When It Doesn't)

Read models for out-of-order events aren't a silver bullet. They work well when:

**Your business logic can handle partial data**: Payment approval can often proceed with fraud score and limits check, even if risk assessment is pending. E-commerce fulfillment can start when payment is confirmed, even if recommendation engine results are still processing.

**Eventual consistency is acceptable**: The payment dashboard might show "processing" for a few hundred milliseconds while verification completes. Most business users can tolerate brief inconsistency in exchange for system responsiveness.

**Decisions can be corrected or refined**: A payment approved with partial data can be flagged for additional review when complete risk data arrives. An order can be expedited or delayed based on complete customer analysis.

**You have clear business rules for conflicts**: When fraud assessment contradicts approval, fraud wins. When risk assessment arrives late, it updates data quality but doesn't reverse committed decisions.

This approach struggles when:

**Perfect consistency is required**: Financial accounting, legal compliance, and safety-critical systems often can't tolerate any inconsistency, even briefly.

**Business logic requires complete data**: Some decisions genuinely can't be made with partial information. Credit limit increases might require complete financial analysis before any approval.

**Rollback costs are high**: If reversing a decision is expensive or impossible, you need stronger ordering guarantees before committing.

**Users can't tolerate uncertainty**: Some interfaces need to show definitive status immediately, not "processing" or "partial data available."

The key insight is recognizing that many business processes naturally work with incomplete information. Humans make decisions all the time with imperfect data, then refine those decisions as more information arrives. Your software can often do the same.

## Patterns for Out-of-Order Events

Cross-service coordination creates persistent ordering challenges. Payment authorization coordinates fraud detection (one service), risk assessment (another service), and merchant verification (a third service). Each publishes independently to different topics. No ordering relationship exists between these streams.

The patterns for handling this:

**Store first, validate later**: Accept events even when they arrive out of logical sequence. Reconcile when more information arrives.

**Use timestamps for conflict resolution, not ordering**: Timestamps distinguish newer from older data when handling duplicates or retries. They don't establish sequence.

**Make business logic tolerant of missing data**: Design decisions to work with available information rather than requiring complete datasets.

**Publish clean events after reconciliation**: Process unordered events and build consistent state, then publish well-ordered events for downstream consumers.

## Moving Forward

Out-of-order events are common in distributed systems. You can spend considerable effort trying to enforce ordering, or you can build systems that handle unordered events effectively.

Read models provide a practical way to handle out-of-order events without sacrificing system responsiveness or business functionality. They're not as clean as perfectly ordered event streams, but they work when multiple queues, retry logic, and independent services cause events to arrive out of sequence.

The next time your fraud alert arrives before your payment exists, build a read model that can store that fraud alert, correlate it when the payment arrives, and make business decisions with available data.

Your systems will be more resilient, and event disorder won't disrupt your business operations.