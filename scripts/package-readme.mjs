// Writes the README of a package from the repo-root README, so npm shows the same page as GitHub.
// Runs as the package's `prepack` (cwd = the package folder): `node ../../scripts/package-readme.mjs`.
//
// npm resolves a relative link against the package folder on GitHub (`repository.directory`), where the root README's
// links (`docs/…`, `assets/…`) do not exist; so every relative link becomes absolute: images to the raw file, the rest
// to the file on GitHub. The output is generated and gitignored; the root README is the only one edited.

import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = 'aneldev/dyna-ai-gateway';
const BRANCH = 'main';
const BLOB_URL = `https://github.com/${REPO}/blob/${BRANCH}/`;
const RAW_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'README.md'), 'utf8');

// `](target)` of a link or `![alt](target)` of an image; a target with a scheme, `#` or `/` is left as it is.
const RELATIVE_LINK = /(!?)\[([^\]]*)\]\((?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)\)/gi;

const readme = source.replace(RELATIVE_LINK, (_match, bang, text, target) =>
  `${bang}[${text}](${bang ? RAW_URL : BLOB_URL}${target.replace(/^\.\//, '')})`);

const outputPath = path.join(process.cwd(), 'README.md');
writeFileSync(outputPath, readme);
console.log(`README.md written from the repo-root README into ${path.relative(root, outputPath) || '.'}`);
