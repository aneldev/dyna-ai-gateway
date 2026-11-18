# dyna-ai-gateway-s3

S3 adapter of dyna-ai-gateway: the blob store of the files

**Not implemented yet.** This package is a placeholder of [dyna-ai-gateway](../../README.md):
it exports nothing and is not published (`private: true`) until the adapter is written. Its peer dependencies
(the AWS SDK and `dyna-ai-gateway`, each with a version range), its bucket and key layout (always configuration, never
hard-coded) are proposed and approved before any code.

```bash
pnpm --filter dyna-ai-gateway-s3 test-no-coverage   # one todo today
```
