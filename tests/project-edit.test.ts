import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestKit, type TestKit } from './helpers.js';
let k: TestKit;
beforeEach(async () => { k = await createTestKit(); });
afterEach(async () => { await k.close(); });
const body = { expectedVersion: 1, name: 'Edited project', description: 'First line\nSecond line' };
it('edits both fields atomically, records snapshots, replays and preserves description on rename', async () => {
  const result = await k.api('POST', '/api/projects/p1/edit', body, 'admin', 'edit-key');
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ name: body.name, description: body.description, version: 2 });
  const events = k.events('project', 'p1');
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ action: 'projectEdited', before: {name:'Project One',description:'',version:1}, after: {name:body.name,description:body.description,version:2} });
  expect(await k.api('POST','/api/projects/p1/edit',body,'admin','edit-key')).toEqual(result);
  expect((await k.api('POST','/api/projects/p1/edit',{...body,expectedVersion:2})).status).toBe(200);
  expect(k.events('project','p1')).toHaveLength(1);
  expect((await k.api('POST','/api/projects/p1/rename',{expectedVersion:2,name:'Renamed'})).body).toMatchObject({description:body.description,version:3});
});
it('rejects stale, unauthorized and archived edits including cached replay after permission changes', async () => {
  expect((await k.api('POST','/api/projects/p1/edit',body,'dev')).status).toBe(403);
  expect((await k.api('POST','/api/projects/p1/edit',{...body,expectedVersion:9})).status).toBe(409);
  expect((await k.api('POST','/api/projects/p1/edit',body,'admin','cached')).status).toBe(200);
  k.db.prepare('UPDATE members SET is_admin=0 WHERE id=?').run('admin');
  expect((await k.api('POST','/api/projects/p1/edit',body,'admin','cached')).status).toBe(403);
  k.db.prepare('UPDATE members SET is_admin=1 WHERE id=?').run('admin');
  await k.api('POST','/api/projects/p1/archive',{expectedVersion:2});
  expect((await k.api('POST','/api/projects/p1/edit',body,'admin','cached')).status).toBe(409);
  expect((await k.api('POST','/api/projects/p1/edit',{...body,expectedVersion:3})).status).toBe(409);
});
it('validates UTF16 bounds and rolls back if event insertion fails', async () => {
  for (const patch of [{name:'a'.repeat(121)},{description:'😀'.repeat(1001)}])
    expect((await k.api('POST','/api/projects/p1/edit',{...body,...patch})).status).toBe(400);
  await k.failNextEvent();
  expect((await k.api('POST','/api/projects/p1/edit',body)).status).toBe(500);
  expect((await k.api('GET','/api/projects/p1')).body).toMatchObject({name:'Project One',description:'',version:1});
  expect(k.events('project','p1')).toHaveLength(0);
});

it('denies replay to a deactivated identity and bounds exact UTF16 values', async () => {
  const payload = {...body,name:'a'.repeat(120),description:'😀'.repeat(1000)};
  expect((await k.api('POST','/api/projects/p1/edit',payload,'admin','identity')).status).toBe(200);
  k.db.prepare('UPDATE members SET active=0 WHERE id=?').run('admin');
  expect((await k.api('POST','/api/projects/p1/edit',payload,'admin','identity')).status).toBe(401);
  expect(k.events('project','p1')).toHaveLength(1);
});
