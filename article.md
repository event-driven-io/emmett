# When Events Arrive Out of Order: A Pragmatic Guide to Read Models

Your fraud detection system just flagged a payment as high-risk. The only problem? That payment doesn't exist yet in your system. The fraud alert arrived thirty milliseconds before the payment creation event, and now your carefully designed event-sourced aggregate is throwing exceptions because you're trying to apply a fraud score to a non-existent payment.

Parallel business processes are natural and expected. Payment processors like Stripe document "multiple simultaneous verification protocols" during payment authorization - fraud detection, risk assessment, limit checking, and merchant verification all running concurrently. Business stakeholders design these processes to run in parallel because it's faster and more efficient.

The technical implementation creates ordering problems. Events arrive out of sequence because of multiple queues, multiple POD instances, transport mechanisms that don't guarantee ordering, retry logic creating duplicate events with different timestamps, and clock synchronization issues across services. You can't control external teams' messaging topology, and some transports like SQS or Google Pub/Sub only provide "best effort" ordering.

You can try to force ordering through message brokers, sequence numbers, or complex choreography. But coordination across distributed systems requires exponential message exchanges. Three servers need 3 message exchanges; 100 servers need 4,950. The performance penalty grows quickly, and perfect ordering across independent services isn't achievable.

So what do you do when you need to build reliable systems on unreliable ordering?

Read models can handle out-of-order events by building consistent views from inconsistent data streams. This approach accepts that events may arrive out of sequence and designs around that reality.

## The Problem with Perfect Order

Event Sourcing works beautifully when events arrive in sequence. You replay them against your aggregate, each event building on the previous state, until you have a consistent snapshot of what happened.

But Event Sourcing assumes you can rebuild state by replaying events in order. When `FraudScoreCalculated` arrives before `PaymentInitiated`, you have nowhere to apply that fraud score. The aggregate doesn't exist yet. Your business logic fails with null reference exceptions.

This becomes problematic when:

- **Multiple services** generate events independently
- **Multiple queues** and POD instances process events separately
- **Transport mechanisms** don't guarantee ordering (outbox patterns, RabbitMQ with multiple consumers, SQS)
- **Retry logic** creates duplicate events with different timestamps
- **Clock synchronization** across services is imperfect
- **External systems** use messaging topologies you can't control

Consider a payment orchestration system. An external payment gateway sends you `PaymentInitiated` events. Your system then triggers parallel verification services:

- Fraud detection service (fast, automated)
- Risk assessment service (ML model, variable timing)
- Merchant limits checking (database lookup)
- Currency validation service (external API)

Each service completes independently. Fraud detection might finish in 50ms while risk assessment takes 300ms. Queue processing, retry delays, and routing differences mean a 300ms result might arrive before a 50ms result. The fraud service might even process the payment request before your system receives the original `PaymentInitiated` event.

Traditional Event Sourcing can't handle this disorder. It requires ordered events but operates in an environment where ordering isn't guaranteed.

## A Different Approach: Read Models for Unordered Events

Read models change the approach. Instead of trying to enforce order, they accept that events may arrive out of sequence and build consistent views anyway.

Treat incoming events as partial information rather than complete facts. A fraud score arriving before payment creation tells you something about a payment that might exist. Store it, correlate it when the payment arrives, and build decisions from whatever data you have.

Let me show you how this works with a concrete example.

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

The fraud system flagged the payment as high-risk before the payment even existed in your system. The payment got approved before risk assessment completed. Merchant limits were checked after approval had already happened.

Traditional Event Sourcing fails here. You can't apply a fraud score to a payment that doesn't exist. You can't approve a payment that hasn't been risk-assessed yet.

Read models handle this differently. They build a view that can accept partial information and make decisions with whatever data is available.

## Building a Read Model for Unordered Events

Here's how you might structure a read model for payment orchestration:

```typescript
type PaymentOrchestrationView = {
  paymentId: string;

  // Core payment data (might arrive late)
  amount?: number;
  currency?: string;
  gatewayId?: string;
  initiatedAt?: Date;

  // Fraud assessment (might arrive first)
  fraudScore?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  fraudAssessedAt?: Date;

  // Risk evaluation (independent timing)
  riskScore?: number;
  riskFactors?: string[];
  riskAssessedAt?: Date;

  // Merchant validation
  withinLimits?: boolean;
  dailyRemaining?: number;
  limitsCheckedAt?: Date;

  // Decision state
  status: 'unknown' | 'processing' | 'approved' | 'declined';
  approvalDecision?: 'approve' | 'decline';
  decisionReason?: string;

  // Operational metadata
  completionPercentage: number;
  lastUpdated: Date;
  dataQuality: 'partial' | 'sufficient' | 'complete';
};
```

The read model accepts that information might be incomplete. Payment amount might be unknown while fraud score is already calculated. Approval might happen while risk assessment is still pending.

Now comes the crucial part: the `evolve` function that processes events as they arrive, in whatever order they come.

```typescript
const evolve = (
  current: PaymentOrchestrationView | null,
  { type, data: event }: PaymentOrchestrationEvent
): PaymentOrchestrationView | null => {
  switch (type) {
    case 'PaymentInitiated': {
      // This might arrive late - merge with existing data if available
      const existing = current ?? createInitialView(event.paymentId);

      return {
        ...existing,
        amount: event.amount,
        currency: event.currency,
        gatewayId: event.gatewayId,
        initiatedAt: event.initiatedAt,
        lastUpdated: event.initiatedAt,
        ...recalculateStatus(existing),
      };
    }

    case 'FraudScoreCalculated': {
      // This might arrive before PaymentInitiated - that's fine
      const existing = current ?? createInitialView(event.paymentId);

      // Only update if this is newer fraud data
      if (existing.fraudAssessedAt && event.calculatedAt <= existing.fraudAssessedAt) {
        return existing;
      }

      const updated = {
        ...existing,
        fraudScore: event.score,
        riskLevel: event.riskLevel,
        fraudAssessedAt: event.calculatedAt,
        lastUpdated: event.calculatedAt,
      };

      // High fraud risk immediately declines, regardless of other factors
      if (event.riskLevel === 'high') {
        return {
          ...updated,
          status: 'declined',
          approvalDecision: 'decline',
          decisionReason: `High fraud risk detected: score ${event.score}`,
          ...recalculateStatus(updated),
        };
      }

      return recalculateStatus(updated);
    }

    case 'PaymentApproved': {
      const existing = current ?? createInitialView(event.paymentId);

      // Check if this approval conflicts with existing risk data
      if (existing.riskLevel === 'high') {
        // Log this conflict but don't override fraud decision
        return {
          ...existing,
          decisionReason: `Approval attempted but overridden by fraud (score: ${existing.fraudScore})`,
          lastUpdated: event.approvedAt,
        };
      }

      return {
        ...existing,
        status: 'approved',
        approvalDecision: 'approve',
        decisionReason: `Approved by ${event.approvedBy}`,
        lastUpdated: event.approvedAt,
        ...recalculateStatus(existing),
      };
    }

    case 'RiskAssessmentCompleted': {
      const existing = current ?? createInitialView(event.paymentId);

      // Risk assessment might complete after approval - update but don't override decisions
      const updated = {
        ...existing,
        riskScore: event.riskScore,
        riskFactors: event.factors,
        riskAssessedAt: event.assessedAt,
        lastUpdated: event.assessedAt,
      };

      // If payment is already decided, don't change decision but update data quality
      if (existing.status === 'approved' || existing.status === 'declined') {
        return recalculateStatus(updated);
      }

      return recalculateStatus(updated);
    }

    case 'MerchantLimitsChecked': {
      const existing = current ?? createInitialView(event.paymentId);

      const updated = {
        ...existing,
        withinLimits: event.withinLimits,
        dailyRemaining: event.dailyRemaining,
        limitsCheckedAt: event.checkedAt,
        lastUpdated: event.checkedAt,
      };

      // Limit violations decline payments regardless of other factors
      if (!event.withinLimits) {
        return {
          ...updated,
          status: 'declined',
          approvalDecision: 'decline',
          decisionReason: `Merchant daily limit exceeded. Remaining: $${event.dailyRemaining}`,
          ...recalculateStatus(updated),
        };
      }

      return recalculateStatus(updated);
    }

    case 'PaymentDeclined': {
      const existing = current ?? createInitialView(event.paymentId);

      return {
        ...existing,
        status: 'declined',
        approvalDecision: 'decline',
        decisionReason: event.reason,
        lastUpdated: event.declinedAt,
        ...recalculateStatus(existing),
      };
    }

    default:
      return current;
  }
};
```

The `evolve` function embodies the core principle: accept unordered events, store what you can, make decisions with available data.

Let's look at the helper functions that make this work:

```typescript
const createInitialView = (paymentId: string): PaymentOrchestrationView => ({
  paymentId,
  status: 'unknown',
  completionPercentage: 0,
  lastUpdated: new Date(),
  dataQuality: 'partial',
});

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
    view.amount !== undefined,           // Payment initiated
    view.fraudScore !== undefined,      // Fraud assessed
    view.riskScore !== undefined,       // Risk evaluated
    view.withinLimits !== undefined,    // Limits checked
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

Here's how this looks in practice with Emmett:

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

## Lessons from the Trenches

I learned these patterns while helping a colleague debug out-of-order event processing issues. His system was receiving events from multiple queues and POD instances, creating unpredictable ordering. Events arrived like: Credit Score → Phone Call Ended → Phone Status Updated, when the logical order should have been: Phone Called → Phone Status Updated → Phone Call Ended.

His first instinct was to sort events by timestamp before processing. This failed for multiple reasons: timestamps across services weren't synchronized, retry logic created duplicate events with different timestamps, and some events legitimately occurred simultaneously.

The solution was treating events as partial information rather than complete facts. A phone call ending before it started? Store both pieces of information and let business logic decide what to do. A status update for a non-existent call? Create a placeholder and fill in details when the call creation event arrives.

The patterns that emerged:

**Store first, validate later**: Accept events even when they don't make sense. Reconcile data when more information arrives.

**Use timestamps for conflict resolution, not ordering**: When you receive duplicate or conflicting information, timestamps help you decide which version to keep. Don't rely on them for event sequencing.

**Make business logic tolerant of missing data**: Design decision-making processes to work with available information rather than requiring complete datasets.

**Publish clean events after reconciliation**: Once you've processed unordered events and built consistent state, publish new, well-ordered events for downstream systems that need predictability.

This approach requires more complex business logic, careful edge case handling, and clear communication about "eventual consistency" with business stakeholders. But it works when perfect ordering isn't achievable.

## Moving Forward

Out-of-order events are common in distributed systems. You can spend considerable effort trying to enforce ordering, or you can build systems that handle unordered events effectively.

Read models provide a practical way to handle out-of-order events without sacrificing system responsiveness or business functionality. They're not as clean as perfectly ordered event streams, but they work when multiple queues, retry logic, and independent services cause events to arrive out of sequence.

The next time your fraud alert arrives before your payment exists, build a read model that can store that fraud alert, correlate it when the payment arrives, and make business decisions with available data.

Your systems will be more resilient, and event disorder won't disrupt your business operations.