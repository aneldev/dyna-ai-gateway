// Releases one publishable package of the workspace: `pnpm release [package-name]` (default: dyna-ai-gateway).
//
// Steps, each one aborting the release when it fails:
//   1. guards: logged in to npm, clean working tree, the CHANGELOG has entries under "## [Unreleased]"
//   2. bumps the version: a prerelease (`0.0.1-beta.4` → `0.0.1-beta.5`) while the version has a prerelease suffix,
//      otherwise a patch (`0.1.2` → `0.1.3`)
//   3. moves the "[Unreleased]" entries of the CHANGELOG under the new version with today's date
//   4. commits "Release <package> v<version>" and tags it "<package>@<version>"
//   5. publishes (the package's `prepublishOnly` builds it; its `publishConfig.tag` picks the dist-tag)
//   6. pushes the branch and the tag
//
// A failure after step 4 leaves the commit and the tag local: `git reset --hard HEAD~1 && git tag -d <tag>` undoes them.

import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = process.argv[2] ?? 'dyna-ai-gateway';
const packageDir = path.join(root, 'packages', packageName);
const packageJsonPath = path.join(packageDir, 'package.json');
const changelogPath = path.join(packageDir, 'CHANGELOG.md');

// `pnpm run` exports pnpm's own settings as `npm_config_*`; npm warns on each one it does not know, so the children get
// an environment without them.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('npm_config_')));
const run = (command, args, options = {}) =>
  execFileSync(command, args, {cwd: root, env, stdio: 'inherit', ...options});
const read = (command, args, options = {}) =>
  execFileSync(command, args, {cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options}).trim();
const fail = message => {
  console.error(`\nrelease aborted: ${message}`);
  process.exit(1);
};

// 1. guards
const currentVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
try {
  read('npm', ['whoami'], {stdio: ['ignore', 'pipe', 'ignore']});
} catch {
  fail('not logged in to npm — run `npm login` first');
}
if (read('git', ['status', '--porcelain'])) fail('the working tree is not clean — commit or stash first');

const changelog = readFileSync(changelogPath, 'utf8');
if ((changelog.match(/^## \[Unreleased\]/gm) ?? []).length > 1) {
  fail('CHANGELOG.md has "## [Unreleased]" more than once — keep only the one at the top');
}
const unreleasedMatch = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## \[|(?![\s\S]))/m);
if (!unreleasedMatch) fail('CHANGELOG.md has no "## [Unreleased]" section');
if (!unreleasedMatch[1].trim()) fail('CHANGELOG.md has no entries under "## [Unreleased]" — document the release first');

// 2. bump
const bump = currentVersion.includes('-') ? 'prerelease' : 'patch';
run('npm', ['version', bump, '--no-git-tag-version'], {cwd: packageDir});
const version = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
console.log(`\n${packageName}: ${currentVersion} → ${version} (${bump})`);

// 3. changelog
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  changelogPath,
  changelog.replace(/^## \[Unreleased\]\n/m, `## [Unreleased]\n\n## [${version}] - ${today}\n`),
);

// 4. commit + tag
const tag = `${packageName}@${version}`;
run('git', ['add', packageJsonPath, changelogPath]);
run('git', ['commit', '-m', `Release ${packageName} v${version}`]);
run('git', ['tag', tag]);

// 5. publish
run('pnpm', ['--filter', packageName, 'publish']);

// 6. push
run('git', ['push']);
run('git', ['push', 'origin', tag]);
console.log(`\nreleased ${tag}`);
