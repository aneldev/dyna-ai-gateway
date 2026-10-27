# dyna-ai-gateway-mongodb

MongoDB adapters of dyna-ai-gateway: the repositories of every store and the Atlas Vector Search index

**Not implemented yet.** This package is the placeholder of milestone M7 of [dyna-ai-gateway](../dyna-ai-gateway/README.md):
it exports nothing and is not published (`private: true`) until the adapter is written. M7 decides its peer dependencies
(the database driver and `dyna-ai-gateway`, each with a version range), the names of its collections or tables (always
configuration, never hard-coded) and the storage layout, which is proposed and approved before any code.

```bash
pnpm --filter dyna-ai-gateway-mongodb test-no-coverage   # one todo today
```
