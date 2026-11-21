# dyna-ai-gateway-postgres

PostgreSQL adapters of dyna-ai-gateway: the repositories of every store (a vector index is decided with the proposal)

**Not implemented yet.** This package is a placeholder of [dyna-ai-gateway](../../README.md):
it exports nothing and is not published (`private: true`) until the adapter is written. Its peer dependencies
(the database driver and `dyna-ai-gateway`, each with a version range), the names of its collections or tables (always
configuration, never hard-coded) and the storage layout are proposed and approved before any code.

```bash
pnpm --filter dyna-ai-gateway-postgres test-no-coverage   # one todo today
```
