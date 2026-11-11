// Type-checks the ```ts samples of Markdown pages against the gateway's sources: `pnpm docs:check-samples [folder…]`
// (default: docs/24-learning-paths). Exits non-zero on the first type error.
//
// Each page becomes one .ts file under temp/check-doc-samples/:
//   - the imports of all its samples are merged at the top; `dyna-ai-gateway` and `dyna-ai-gateway/vercel-ui` resolve to
//     packages/dyna-ai-gateway/src, so a sample is checked against the code as it is now, not against the last build
//   - the samples run in nested blocks of one async function, so a later sample sees the names of the earlier ones and
//     may shadow them
//   - a sample's own `declare …` line goes to the top level, a leading `export ` is dropped (a route handler runs as a local)
// The objects a page takes as given (the application's own code, ids the screen holds) are declared in prelude.ts.

import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const gatewayDir = path.join(root, 'packages', 'dyna-ai-gateway');
const outDir = path.join(root, 'temp', 'check-doc-samples');
const folders = process.argv.length > 2 ? process.argv.slice(2) : ['docs/24-learning-paths'];

const importPattern = /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";/;

const extractPage = (markdown) => {
  const blocks = [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
  const imports = new Map();
  const declares = [];
  const bodies = blocks.map((block) => {
    // An import may span lines: take each one whole before splitting the rest into lines
    const rest = block.replace(/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"[^"]+";/g, (statement) => {
      const [, names, module] = statement.match(importPattern);
      const set = imports.get(module) ?? new Set();
      names.split(',').map((name) => name.trim()).filter(Boolean).forEach((name) => set.add(name));
      imports.set(module, set);
      return '';
    });
    return rest
      .split('\n')
      .filter((line) => {
        if (!line.startsWith('declare ')) return true;
        declares.push(line);
        return false;
      })
      .map((line) => line.replace(/^export /, ''))
      .join('\n');
  });
  if (!blocks.length) return null;
  return [
    '/* eslint-disable */',
    ...[...imports].map(([module, names]) => `import {${[...names].sort().join(', ')}} from "${module}";`),
    'import "./prelude";',
    ...declares,
    'export async function page(): Promise<void> {',
    ...bodies.map((body, index) => `// sample ${index + 1}\n{\n${body}`),
    '}'.repeat(bodies.length),
    '}',
    '',
  ].join('\n');
};

rmSync(outDir, {recursive: true, force: true});
mkdirSync(outDir, {recursive: true});
writeFileSync(path.join(outDir, 'prelude.ts'), readFileSync(path.join(here, 'prelude.ts')));

let pages = 0;
for (const folder of folders) {
  const dir = path.resolve(root, folder);
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.md')).sort()) {
    const source = extractPage(readFileSync(path.join(dir, file), 'utf8'));
    if (!source) continue;
    const name = `${path.basename(folder)}__${file.slice(0, -3)}`.replace(/[^\w]/g, '_');
    writeFileSync(path.join(outDir, `${name}.ts`), source);
    pages++;
  }
}

const gatewayModules = path.join(gatewayDir, 'node_modules');
writeFileSync(path.join(outDir, 'tsconfig.json'), JSON.stringify({
  extends: path.join(root, 'tsconfig.base.json'),
  compilerOptions: {
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
    baseUrl: '.',
    typeRoots: [path.join(root, 'node_modules', '@types')],
    types: ['node'],
    paths: {
      'dyna-ai-gateway': [path.join(gatewayDir, 'src', 'index.ts')],
      'dyna-ai-gateway/vercel-ui': [path.join(gatewayDir, 'src', 'entries', 'vercel-ui', 'index.ts')],
      '*': [path.join(gatewayModules, '*'), path.join(root, 'node_modules', '*')],
    },
  },
  include: ['*.ts'],
}, null, 2));

console.log(`check-doc-samples: ${pages} page(s) from ${folders.join(', ')} → ${path.relative(root, outDir)}`);
try {
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', outDir], {stdio: 'inherit'});
  console.log('check-doc-samples: 0 errors');
} catch {
  console.error('check-doc-samples: type errors above (the files are kept in temp/check-doc-samples)');
  process.exit(1);
}
