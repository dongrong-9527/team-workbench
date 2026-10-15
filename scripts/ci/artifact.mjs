// Delivery-only gates. Never imported by or copied into the application package.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_SHA = '466eea79cb75d92a964f9369c470711c070d8450';
export const BUILD_IMAGE = 'node:24.21.0-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0';
const LOCK_SHA = '9026d8bda8f411022b59090930440943777ebd74cd41e3704a47835058f30a00';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const uploadNames = ['SHA256SUMS', 'candidate.tar.gz', 'release-manifest.json', 'verification.json'].sort();

export async function assertSource(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== SOURCE_SHA) throw Error('Application source SHA mismatch');
  if (git('status', '--porcelain', '--untracked-files=all')) throw Error('Application source checkout must be clean');
  const lockBytes = await readFile(join(root, 'package-lock.json'));
  if (hash(lockBytes) !== LOCK_SHA) throw Error('Untrusted source lockfile');
  for (const entry of Object.values(JSON.parse(lockBytes).packages)) {
    if (entry.resolved && !entry.link) {
      const url = new URL(entry.resolved);
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.username || url.password || !entry.integrity)
        throw Error('Dependencies must use integrity-bound public npm packages');
    }
  }
}
function checkPrivacy(path, bytes) {
  // These two lockfile-bound vendor JS fixtures were inspected as public code.
  if (/(^|\/)fixtures?(?:\/|$)/i.test(path) && ![
    'node_modules/json-schema-traverse/spec/fixtures/schema.js',
    'node_modules/sonic-boom/fixtures/firehose.js',
  ].includes(path)) throw Error('Forbidden private fixture filename');
  if (/(^|\/)(?:\.git|\.env(?:\..*)?|\.npmrc|\.ssh|\.aws|private-inputs|private-tools|logs?|traces?|test-results)(?:\/|$)/i.test(path) || /\.(?:db|sqlite(?:3)?|sqlite-wal|sqlite-shm|docx?|xlsx?|pem|key|p12|log|har)$/i.test(path) || /(?:-wal|-shm)$/.test(path))
    throw Error('Forbidden private package filename');
  // Scan every byte buffer, including binary files; never print matching content.
  let text = bytes.toString('utf8');
  // Exact public examples shipped by the lockfile-bound @types/node 24.19.2.
  // This does not exempt any file from scanning or allow arbitrary userinfo URLs.
  if (/^node_modules\/@types\/node\/(?:http|https|url)\.d\.ts$/.test(path))
    text = text.replace(/https?:\/\/(?:(?:abc:xyz|abc:123|123:xyz)@example\.com(?=['/])|a:b@(?:測試\?abc#foo|xn--g6w251d\/\?abc#foo))/g, 'public-documentation-example');
  if (/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|https?:\/\/[^\s/:]+:[^\s/@]+@|\/(?:workspace\/private-|home\/runner\/work\/)|\b(?:file|folder)_[a-f0-9]{24,}/.test(text))
    throw Error('Private content or credential marker in package');
}
export async function auditPackage(root) {
  const actual = [];
  let files = 0;
  async function walk(prefix = '') {
    for (const name of (await readdir(join(root, prefix))).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (!/^[-a-zA-Z0-9_@.+/]+$/.test(path)) throw Error('Unsafe package path');
      const stat = await lstat(join(root, path));
      if (stat.isDirectory()) { await walk(path); continue; }
      if (!stat.isFile()) throw Error('Package must contain only regular files, no symlinks');
      const bytes = await readFile(join(root, path));
      checkPrivacy(path, bytes);
      if (!/^(?:apps\/api\/dist\/.*\.(?:js|sql)|public\/.*\.(?:html|js|css|png|jpg|jpeg|webp|svg|ico|woff2?)|node_modules\/.+|runtime\/(?:node|LICENSE)|package.json|release-manifest.json)$/.test(path))
        throw Error('Unexpected package file');
      files++;
      if (path !== 'release-manifest.json') actual.push({ path, sha256: hash(bytes), size: bytes.length });
    }
  }
  await walk();
  const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
  if (manifest.commit !== SOURCE_SHA) throw Error('Manifest source SHA mismatch');
  const { sha256, ...body } = manifest;
  if (sha256 !== hash(JSON.stringify(body))) throw Error('Manifest checksum mismatch');
  if (!Array.isArray(manifest.files) || actual.length !== manifest.files.length || actual.some((file, i) => ['path', 'sha256', 'size'].some((key) => file[key] !== manifest.files[i][key]))) throw Error('Package inventory/hash mismatch');
  if (manifest.nodeVersion !== '24.21.0' || manifest.nodeABI !== '137' || manifest.arch !== 'x64' || manifest.platform !== 'linux') throw Error('Unexpected runtime identity');
  for (const path of ['runtime/node', 'runtime/LICENSE', 'package.json', 'public/index.html', 'apps/api/dist/apps/api/src/server.js'])
    if (!actual.some((file) => file.path === path)) throw Error('Required package inventory missing');
  return { files, scannedFiles: files };
}
export async function assertUploadFiles(directory) {
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(uploadNames)) throw Error('Unexpected or missing upload file');
  for (const name of uploadNames) {
    const stat = await lstat(join(directory, name));
    if (!stat.isFile() || stat.size === 0) throw Error('Upload file must be a nonempty regular file');
  }
}
export async function verifyDownload(downloaded, original) {
  await assertUploadFiles(downloaded);
  await assertUploadFiles(original);
  // Bind the downloaded sidecar/summary to the previously audited upload bytes
  // before interpreting paths or printing any downloaded content.
  for (const name of uploadNames)
    if (hash(await readFile(join(downloaded, name))) !== hash(await readFile(join(original, name))))
      throw Error('Downloaded artifact byte mismatch');
  execFileSync('sha256sum', ['--check', '--strict', 'SHA256SUMS'], { cwd: downloaded, stdio: 'pipe' });
  return (await readFile(join(downloaded, 'verification.json'), 'utf8')) +
    (await readFile(join(downloaded, 'SHA256SUMS'), 'utf8'));
}
async function finalize(root, delivery, smokeFile, configSHA) {
  if (!/^[a-f0-9]{40}$/.test(configSHA)) throw Error('Invalid configuration SHA');
  const audit = await auditPackage(root);
  const manifestBytes = await readFile(join(root, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.buildImage !== BUILD_IMAGE || manifest.buildGlibc !== '2.36') throw Error('Build provenance mismatch');
  const smoke = JSON.parse(await readFile(smokeFile, 'utf8'));
  if (smoke.ok !== true || smoke.createdEvents !== 1 || smoke.idempotencyRows !== 1 || !Number.isInteger(smoke.durationMs) || smoke.durationMs < 0) throw Error('Business smoke failed');
  // Deliberate allowlist: never propagate arbitrary test output, paths or credentials.
  const verification = {
    applicationSourceSHA: SOURCE_SHA, configurationSHA: configSHA,
    archiveSHA256: hash(await readFile(join(delivery, 'candidate.tar.gz'))),
    manifestSHA256: hash(manifestBytes), sourceLockSHA256: LOCK_SHA,
    buildImage: BUILD_IMAGE, nativeDependencies: 'lockfile npm ci, including optional prebuilt binaries; no claimed recompilation',
    nodeVersion: manifest.nodeVersion, nodeABI: manifest.nodeABI,
    ...audit, nativeRuntime: 'passed on actual extracted package',
    smoke: { ok: true, createdEvents: 1, idempotencyRows: 1, durationMs: smoke.durationMs },
  };
  await copyFile(join(root, 'release-manifest.json'), join(delivery, 'release-manifest.json'));
  await writeFile(join(delivery, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
  const sums = [];
  for (const name of ['candidate.tar.gz', 'release-manifest.json', 'verification.json']) sums.push(`${hash(await readFile(join(delivery, name)))}  ${name}`);
  await writeFile(join(delivery, 'SHA256SUMS'), sums.join('\n') + '\n');
  await assertUploadFiles(delivery);
  for (const name of ['release-manifest.json', 'verification.json', 'SHA256SUMS']) checkPrivacy(name, await readFile(join(delivery, name)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'source') await assertSource(args[0]);
  else if (command === 'audit') console.log(JSON.stringify(await auditPackage(args[0])));
  else if (command === 'finalize') await finalize(...args);
  else if (command === 'download') process.stdout.write(await verifyDownload(...args));
  else throw Error('Unknown delivery gate');
}
