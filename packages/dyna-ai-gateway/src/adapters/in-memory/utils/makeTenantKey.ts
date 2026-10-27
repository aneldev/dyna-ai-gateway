/**
 * Map key of a record that belongs to a tenant.
 * JSON keeps the two parts apart: with a separator, tenant `a` + id `b|r1` and tenant `a|b` + id `r1` were one key.
 */
export const makeTenantKey = (tenantId: string, id: string): string => JSON.stringify([tenantId, id]);
