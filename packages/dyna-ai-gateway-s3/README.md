# dyna-ai-gateway-s3

S3 adapter of dyna-ai-gateway: the blob store of the files

**Not implemented yet.** This package is the placeholder of milestone M7 of [dyna-ai-gateway](../dyna-ai-gateway/README.md):
it exports nothing and is not published (`private: true`) until the adapter is written. M7 decides its peer dependencies
(the database driver and `dyna-ai-gateway`, each with a version range), the names of its collections or tables (always
configuration, never hard-coded) and the storage layout, which is proposed and approved before any code.

```bash
pnpm --filter dyna-ai-gateway-s3 test-no-coverage   # one todo today
```
