import { describe, it } from 'node:test';
import {
  GroupCheckoutWorkflow,
  GuestStayStatus,
} from '../workflows/workflow.unit.spec';
import { WorkflowSpecification } from './workflowSpecification';

const now = new Date();

const given = WorkflowSpecification.for(GroupCheckoutWorkflow);

void describe('GroupCheckout workflow', () => {
  void describe('InitiateGroupCheckout', () => {
    void it('produces GroupCheckoutInitiated and CheckOut commands', () => {
      given([])
        .when({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            now,
          },
        })
        .then([
          {
            type: 'GroupCheckoutInitiated',
            data: {
              groupCheckoutId: 'gc-1',
              clerkId: 'clerk-1',
              guestStayAccountIds: ['guest-1', 'guest-2'],
              initiatedAt: now,
            },
          },
          {
            type: 'CheckOut',
            data: { guestStayAccountId: 'guest-1', groupCheckoutId: 'gc-1' },
            metadata: { now },
          },
          {
            type: 'CheckOut',
            data: { guestStayAccountId: 'guest-2', groupCheckoutId: 'gc-1' },
            metadata: { now },
          },
        ]);
    });

    void it('ignores initiation when already pending', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1'],
            initiatedAt: now,
          },
        },
      ])
        .when({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-2',
            guestStayAccountIds: ['guest-2'],
            now,
          },
        })
        .thenNothingHappened();
    });
  });

  void describe('GuestCheckedOut', () => {
    void it('ignores when no groupCheckoutId', () => {
      given([])
        .when({
          type: 'GuestCheckedOut',
          data: { guestStayAccountId: 'guest-1', checkedOutAt: now },
        })
        .thenNothingHappened();
    });

    void it('ignores when workflow not existing', () => {
      given([])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when workflow already finished', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1'],
            initiatedAt: now,
          },
        },
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        },
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when guest already checked out', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('produces nothing when other guests still pending', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('produces GroupCheckoutCompleted when all guests checked out', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-2',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .then({
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [
              GuestStayStatus.Completed,
              GuestStayStatus.Completed,
            ],
            completedAt: now,
          },
        });
    });

    void it('produces GroupCheckoutCompleted when at least one guest completed', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-2',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .then({
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [
              GuestStayStatus.Failed,
              GuestStayStatus.Completed,
            ],
            completedAt: now,
          },
        });
    });
  });

  void describe('GuestCheckoutFailed', () => {
    void it('ignores when no groupCheckoutId', () => {
      given([])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when workflow not existing', () => {
      given([])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when workflow already finished', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1'],
            initiatedAt: now,
          },
        },
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        },
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when guest already failed', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('produces nothing when other guests still pending', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .thenNothingHappened();
    });

    void it('produces GroupCheckoutFailed when all guests failed', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-2',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        })
        .then({
          type: 'GroupCheckoutFailed',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [],
            failedCheckouts: ['guest-1', 'guest-2'],
            failedAt: now,
          },
        });
    });
  });

  void describe('TimeoutGroupCheckout', () => {
    void it('produces GroupCheckoutTimedOut with checkout statuses', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1', 'guest-2', 'guest-3'],
            initiatedAt: now,
          },
        },
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-2',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        },
      ])
        .when({
          type: 'TimeoutGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            startedAt: now,
            timeOutAt: now,
          },
        })
        .then({
          type: 'GroupCheckoutTimedOut',
          data: {
            groupCheckoutId: 'gc-1',
            incompleteCheckouts: ['guest-3'],
            completedCheckouts: ['guest-1'],
            failedCheckouts: ['guest-2'],
            timedOutAt: now,
          },
        });
    });

    void it('ignores when workflow not existing', () => {
      given([])
        .when({
          type: 'TimeoutGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            startedAt: now,
            timeOutAt: now,
          },
        })
        .thenNothingHappened();
    });

    void it('ignores when workflow already finished', () => {
      given([
        {
          type: 'GroupCheckoutInitiated',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-1',
            guestStayAccountIds: ['guest-1'],
            initiatedAt: now,
          },
        },
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        },
      ])
        .when({
          type: 'TimeoutGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            startedAt: now,
            timeOutAt: now,
          },
        })
        .thenNothingHappened();
    });
  });
});
