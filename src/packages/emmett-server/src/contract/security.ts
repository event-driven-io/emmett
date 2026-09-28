export const Permissions = {
  /** API root, capabilities and documentation */
  discover: 'api:discover',
  /** Stream catalog */
  listStreams: 'streams:list',
  /** Stream metadata, existence and messages */
  readStreams: 'streams:read',
  appendMessages: 'streams:append',
  readSubscriptions: 'subscriptions:read',
  administerServer: 'server:admin',
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

export type Role = 'viewer' | 'editor' | 'admin';

const viewerPermissions: Permission[] = [
  Permissions.discover,
  Permissions.listStreams,
  Permissions.readStreams,
  Permissions.readSubscriptions,
];

const editorPermissions: Permission[] = [
  ...viewerPermissions,
  Permissions.appendMessages,
];

export const RolePermissions: Record<Role, readonly Permission[]> = {
  viewer: viewerPermissions,
  editor: editorPermissions,
  admin: [...editorPermissions, Permissions.administerServer],
};

/**
 * Normalized principal produced by authentication,
 * whether by Emmett or by host application authentication.
 */
export type Principal = {
  id: string;
  /** e.g. `api-key`, `oidc`, `host`, `insecure` */
  authenticationMethod: string;
  roles: readonly Role[];
  /** Additional permissions granted on top of the roles. */
  permissions?: readonly Permission[];
  /** Safe, non-secret authentication metadata, e.g. OIDC claims. */
  claims?: Readonly<Record<string, unknown>>;
};

export const permissionsOf = (principal: Principal): Set<Permission> =>
  new Set([
    ...principal.roles.flatMap((role) => RolePermissions[role] ?? []),
    ...(principal.permissions ?? []),
  ]);
