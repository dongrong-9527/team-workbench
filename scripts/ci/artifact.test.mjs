import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const source = '443407ccf975a2285d5f70cbcc2fa2b0a41ecaab';
// Removing a gate must allow the corresponding real tampered package through.
// Load dynamically so the initial RED is an explicit missing-delivery-gate assertion.
async function gates() {
  const module = await import('./artifact.mjs').catch(() => null);
  assert.ok(module, 'CI artifact validation gates must exist');
  return module;
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'artifact-gates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = { 'package.json': '{"type":"module"}', 'runtime/node': 'runtime', 'runtime/LICENSE': 'license', 'public/index.html': '<html></html>', 'apps/api/dist/apps/api/src/server.js': 'export {};' };
  const manifest = { commit: source, nodeVersion: '24.21.0', nodeABI: '137', platform: 'linux', arch: 'x64', files: [], sha256: '' };
  async function seal() {
    manifest.files = [];
    for (const path of Object.keys(files).sort()) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), files[path]);
      manifest.files.push({ path, size: Buffer.byteLength(files[path]), sha256: sha(files[path]) });
    }
    const { sha256, ...body } = manifest;
    manifest.sha256 = sha(JSON.stringify(body));
    await writeFile(join(root, 'release-manifest.json'), JSON.stringify(manifest));
  }
  await seal();
  return { root, files, manifest, seal };
}
test('accepts an intact fixed-source candidate', async (t) => {
  const f = await fixture(t);
  assert.equal((await (await gates()).auditPackage(f.root)).files, 6);
});
test('rejects a manifest bound to another source even with a valid checksum', async (t) => {
  const f = await fixture(t); f.manifest.commit = 'a'.repeat(40); await f.seal();
  await assert.rejects((await gates()).auditPackage(f.root), /source/i);
});
test('rejects missing, unlisted and changed package bytes', async (t) => {
  const f = await fixture(t); const g = await gates();
  await rm(join(f.root, 'runtime/node')); await assert.rejects(g.auditPackage(f.root), /inventory/i);
  await f.seal(); await writeFile(join(f.root, 'public/extra.js'), 'unlisted'); await assert.rejects(g.auditPackage(f.root), /inventory/i);
  await rm(join(f.root, 'public/extra.js')); await writeFile(join(f.root, 'runtime/node'), 'changed'); await assert.rejects(g.auditPackage(f.root), /inventory/i);
});
test('rejects private files even when included in a valid inventory', async (t) => {
  const f = await fixture(t); f.files['node_modules/example/private.docx'] = 'private'; await f.seal();
  await assert.rejects((await gates()).auditPackage(f.root), /private|forbidden/i);
});
test('scans every file for embedded credential markers', async (t) => {
  const f = await fixture(t); f.files['public/index.html'] = '-----BEGIN PRIVATE KEY-----'; await f.seal();
  await assert.rejects((await gates()).auditPackage(f.root), /private|credential/i);
});
test('rejects manifest checksum changes and symlinks', async (t) => {
  const f = await fixture(t); const g = await gates();
  f.manifest.sha256 = '0'.repeat(64); await writeFile(join(f.root, 'release-manifest.json'), JSON.stringify(f.manifest));
  await assert.rejects(g.auditPackage(f.root), /manifest/i);
  await f.seal(); await symlink('/etc/passwd', join(f.root, 'public/link'));
  await assert.rejects(g.auditPackage(f.root), /regular|symlink/i);
});
test('rejects wrong source checkout before install/build', async (t) => {
  const f = await fixture(t); execFileSync('git', ['init', '-q', f.root]);
  execFileSync('git', ['-C', f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  await assert.rejects((await gates()).assertSource(f.root), /source/i);
});
test('upload gate rejects missing and unexpected files', async (t) => {
  const f = await fixture(t); const g = await gates();
  const delivery = join(f.root, 'delivery'); await mkdir(delivery);
  for (const name of ['candidate.tar.gz', 'SHA256SUMS', 'release-manifest.json', 'verification.json']) await writeFile(join(delivery, name), 'fixture');
  await g.assertUploadFiles(delivery);
  await writeFile(join(delivery, 'smoke.log'), 'secret'); await assert.rejects(g.assertUploadFiles(delivery), /upload/i);
  await rm(join(delivery, 'smoke.log')); await rm(join(delivery, 'candidate.tar.gz')); await assert.rejects(g.assertUploadFiles(delivery), /upload/i);
});
