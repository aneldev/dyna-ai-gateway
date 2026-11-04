/**
 * makeTenantKey -- the Map key of a record that belongs to a tenant
 *
 * # About
 *
 * > Two parts that can never run into each other.
 *
 * The JSON of `[tenantId, id]`. A separator would not do: tenant `a` + id `b|r1` and tenant `a|b` + id `r1` were one key.
 *
 * # Who needs it
 *
 * Every in-memory repository that stores per tenant.
 */
export const makeTenantKey = (tenantId: string, id: string): string => JSON.stringify([tenantId, id]);
