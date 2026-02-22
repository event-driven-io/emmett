import { describe, it } from 'node:test';
import {
  GroupCheckoutWorkflow,
  GuestStayStatus,
  type GroupCheckoutCompleted,
  type GroupCheckoutFailed,
  type GroupCheckoutInitiated,
  type GroupCheckoutTimedOut,
  type GuestCheckedOut,
  type GuestCheckoutFailed,
  type InitiateGroupCheckout,
  type TimeoutGroupCheckout,
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
        } satisfies InitiateGroupCheckout)
        .then([
          {
            type: 'GroupCheckoutInitiated',
            data: {
              groupCheckoutId: 'gc-1',
              clerkId: 'clerk-1',
              guestStayAccountIds: ['guest-1', 'guest-2'],
              initiatedAt: now,
            },
          } satisfies GroupCheckoutInitiated,
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
        } satisfies GroupCheckoutInitiated,
      ])
        .when({
          type: 'InitiateGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            clerkId: 'clerk-2',
            guestStayAccountIds: ['guest-2'],
            now,
          },
        } satisfies InitiateGroupCheckout)
        .thenNothingHappened();
    });
  });

  void describe('GuestCheckedOut', () => {
    void it('ignores when no groupCheckoutId', () => {
      given([])
        .when({
          type: 'GuestCheckedOut',
          data: { guestStayAccountId: 'guest-1', checkedOutAt: now },
        } satisfies GuestCheckedOut)
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
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        } satisfies GroupCheckoutCompleted,
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut,
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutInitiated,
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut,
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-2',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutCompleted);
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed,
      ])
        .when({
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-2',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut)
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
        } satisfies GroupCheckoutCompleted);
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
        } satisfies GuestCheckoutFailed)
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
        } satisfies GuestCheckoutFailed)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        } satisfies GroupCheckoutCompleted,
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed,
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed)
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
        } satisfies GroupCheckoutInitiated,
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-1',
            reason: 'BalanceNotSettled',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed,
      ])
        .when({
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-2',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed)
        .then({
          type: 'GroupCheckoutFailed',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [],
            failedCheckouts: ['guest-1', 'guest-2'],
            failedAt: now,
          },
        } satisfies GroupCheckoutFailed);
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GuestCheckedOut',
          data: {
            guestStayAccountId: 'guest-1',
            checkedOutAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckedOut,
        {
          type: 'GuestCheckoutFailed',
          data: {
            guestStayAccountId: 'guest-2',
            reason: 'NotCheckedIn',
            failedAt: now,
            groupCheckoutId: 'gc-1',
          },
        } satisfies GuestCheckoutFailed,
      ])
        .when({
          type: 'TimeoutGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            startedAt: now,
            timeOutAt: now,
          },
        } satisfies TimeoutGroupCheckout)
        .then({
          type: 'GroupCheckoutTimedOut',
          data: {
            groupCheckoutId: 'gc-1',
            incompleteCheckouts: ['guest-3'],
            completedCheckouts: ['guest-1'],
            failedCheckouts: ['guest-2'],
            timedOutAt: now,
          },
        } satisfies GroupCheckoutTimedOut);
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
        } satisfies TimeoutGroupCheckout)
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
        } satisfies GroupCheckoutInitiated,
        {
          type: 'GroupCheckoutCompleted',
          data: {
            groupCheckoutId: 'gc-1',
            completedCheckouts: [GuestStayStatus.Completed],
            completedAt: now,
          },
        } satisfies GroupCheckoutCompleted,
      ])
        .when({
          type: 'TimeoutGroupCheckout',
          data: {
            groupCheckoutId: 'gc-1',
            startedAt: now,
            timeOutAt: now,
          },
        } satisfies TimeoutGroupCheckout)
        .thenNothingHappened();
    });
  });
});
