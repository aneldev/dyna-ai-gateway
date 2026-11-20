---
description: The AI gateway is multi-tenant, and tenants are optional. A single-tenant application passes an empty tenant id everywhere; a SaaS application passes each customer's id.
keywords: [multi-tenant, single-tenant, tenantId, SaaS, AI gateway]
---

# Tenants are optional

One gateway serves many customers: every call names its tenant, and the profiles, threads, files, memory, knowledge
base and trace of one tenant stay apart from every other's. An application with one customer does not need any of
this.

## One customer: `tenantId: ""`

Pass the empty tenant id everywhere a tenant is asked for: in the `userContext` of every call, on every profile, and in
the back-office calls. With the in-memory stores of the package nothing else changes; a repository or blob adapter of
your own must accept the empty tenant ([Tenants](../20-learn-the-gateway/005-tenants.md#24-a-single-tenant-application)).

```ts
import {IAIProfile, IUserContext} from "dyna-ai-gateway";

const TENANT_ID = ""; // one customer: the empty tenant

const profile: IAIProfile = {...accountingProfile, tenantId: TENANT_ID};
await gateway.aiProfileStore.upsertProfile({tenantId: TENANT_ID, profile});

const userContext: IUserContext = {
  tenantId: TENANT_ID,
  userId: "u-17",
  permissions: [],
  locale: "en-GB",
  timezone: "Europe/Oslo",
  now: new Date(),
};
```

`gateway` and `accountingProfile` are those of [Installation](20-installation.md). The examples of this section use the
tenant `"acme"`; a single-tenant application writes `""` in its place.

## Many customers: the customer's id

Set `tenantId` to the id of the customer the user belongs to, from the authenticated session. The gateway keeps each
tenant's data apart by that id; one gateway instance serves them all.

What is kept per tenant, what is shared, how to add and remove a tenant: [Tenants](../20-learn-the-gateway/005-tenants.md).
