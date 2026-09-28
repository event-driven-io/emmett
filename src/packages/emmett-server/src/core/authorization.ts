import {
  permissionsOf,
  type EventStoreApiOperation,
  type Permission,
  type Principal,
} from '../contract';
import type { StreamIdentity } from './streamIdentity';

/**
 * Everything known about an operation when authorizing it,
 * so policies can later consider stream patterns, tenants or message types
 * without changing endpoint shapes.
 */
export type AuthorizationRequest = {
  principal: Principal;
  operation: EventStoreApiOperation;
  permission: Permission;
  streamName?: string;
  streamIdentity?: StreamIdentity;
  messageTypes?: string[];
  deployment?: Readonly<Record<string, unknown>>;
};

export type Authorize = (
  request: AuthorizationRequest,
) => boolean | Promise<boolean>;

/**
 * Grants an operation when the principal's roles or explicit permissions include its permission.
 */
export const roleBasedAuthorization: Authorize = ({ principal, permission }) =>
  permissionsOf(principal).has(permission);
