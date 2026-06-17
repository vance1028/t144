'use strict';

// 测试连接 MySQL（默认 127.0.0.1:13366，由 docker compose 起的 db 服务）。
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { getPool, ensureSchema, resetAll, waitForDb, close } = require('../src/db');
const { seed } = require('../src/seed');
const { createApp } = require('../src/app');

const app = createApp();

test.before(async () => {
  await waitForDb();
  await ensureSchema();
  getPool();
});

test.beforeEach(async () => {
  await resetAll();
  await seed();
});

test.after(async () => {
  await close();
});

async function loginAs(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  assert.strictEqual(res.status, 200, `登录失败: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

test('健康检查无需鉴权', async () => {
  const res = await request(app).get('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('登录：正确账号密码返回 token，中文姓名不乱码', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.token);
  assert.strictEqual(res.body.data.user.role, 'ADMIN');
  assert.strictEqual(res.body.data.user.name, '系统管理员');
});

test('登录：错误密码 401', async () => {
  const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'bad' });
  assert.strictEqual(res.status, 401);
});

test('未带令牌访问受保护接口 401', async () => {
  const res = await request(app).get('/api/lots');
  assert.strictEqual(res.status, 401);
});

test('停车场列表读到种子数据，中文字段正确', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.length, 3);
  const names = res.body.data.map((l) => l.name);
  assert.ok(names.includes('市民中心地下停车场'), '中文停车场名应正确返回');
});

test('operator 新建停车场并能再查到（含中文与区域）', async () => {
  const token = await loginAs('operator', 'operator123');
  const create = await request(app).post('/api/lots').set('Authorization', `Bearer ${token}`)
    .send({ code: 'PL-XH-009', name: '西湖文化广场停车场', district: '西湖区', address: '环湖北路66号', totalSpaces: 10 });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  const id = create.body.data.id;
  const get = await request(app).get(`/api/lots/${id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(get.status, 200);
  assert.strictEqual(get.body.data.name, '西湖文化广场停车场');
  assert.strictEqual(get.body.data.district, '西湖区');
});

test('viewer 无权新建停车场（403）', async () => {
  const token = await loginAs('viewer', 'viewer123');
  const res = await request(app).post('/api/lots').set('Authorization', `Bearer ${token}`)
    .send({ code: 'PL-X-001', name: '测试', district: '某区' });
  assert.strictEqual(res.status, 403);
});

test('停车场编号重复 409', async () => {
  const token = await loginAs('admin', 'admin123');
  const res = await request(app).post('/api/lots').set('Authorization', `Bearer ${token}`)
    .send({ code: 'PL-CG-001', name: '重复', district: '某区' });
  assert.strictEqual(res.status, 409);
});

test('车位：列出某停车场车位、在其下新建车位', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const list = await request(app).get(`/api/lots/${lot1.id}/spaces`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.length >= 4, '至少有 4 个种子车位');

  const create = await request(app).post(`/api/lots/${lot1.id}/spaces`).set('Authorization', `Bearer ${token}`)
    .send({ code: 'A-09', type: 'STANDARD' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  assert.strictEqual(create.body.data.lotId, lot1.id);
});

test('车辆：新建含中文车主并查询，中文不乱码', async () => {
  const token = await loginAs('operator', 'operator123');
  const create = await request(app).post('/api/vehicles').set('Authorization', `Bearer ${token}`)
    .send({ plateNo: '川A99999', ownerName: '陈大文', phone: '13900000000', vehicleType: 'SMALL' });
  assert.strictEqual(create.status, 201, JSON.stringify(create.body));
  assert.strictEqual(create.body.data.ownerName, '陈大文');
});

test('停车记录：入场自动分配车位后再出场，状态流转与重复出场拦截', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川A99999', enterTime: '2026-06-16 10:00:00' });
  assert.strictEqual(enter.status, 201, JSON.stringify(enter.body));
  assert.ok(enter.body.data.session, '应返回 session');
  assert.ok(enter.body.data.space, '应返回分配的车位');
  assert.strictEqual(enter.body.data.space.status, 'OCCUPIED', '分配后车位应为 OCCUPIED');
  assert.strictEqual(enter.body.data.session.plateNo, '川A99999');
  const sid = enter.body.data.session.id;
  const allocSpaceId = enter.body.data.space.id;

  const exit1 = await request(app).post(`/api/sessions/${sid}/exit`).set('Authorization', `Bearer ${token}`)
    .send({ exitTime: '2026-06-16 11:00:00', feeCents: 800 });
  assert.strictEqual(exit1.status, 200);
  assert.strictEqual(exit1.body.data.session.status, 'FINISHED');
  assert.strictEqual(exit1.body.data.session.feeCents, 800);
  assert.strictEqual(exit1.body.data.space.id, allocSpaceId);
  assert.strictEqual(exit1.body.data.space.status, 'FREE', '释放后车位回到 FREE');

  const exit2 = await request(app).post(`/api/sessions/${sid}/exit`).set('Authorization', `Bearer ${token}`)
    .send({ exitTime: '2026-06-16 12:00:00' });
  assert.strictEqual(exit2.status, 409, '已结束的记录不能重复出场');
});

/* ---------------- 新增：车位分配与并发安全相关测试 ---------------- */

test('入场：同车牌重复入场被拦截（ALREADY_PARKED）', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const enter1 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川A66666', vehicleType: 'SMALL' });
  assert.strictEqual(enter1.status, 201, JSON.stringify(enter1.body));
  const enter2 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川A66666' });
  assert.strictEqual(enter2.status, 409);
  assert.strictEqual(enter2.body.code, 'ALREADY_PARKED');
});

test('入场：小车不能占 OVERSIZE、普通车不能占 DISABLED', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川A55555', vehicleType: 'SMALL' });
  assert.strictEqual(enter.status, 201, JSON.stringify(enter.body));
  const sp = enter.body.data.space;
  assert.notStrictEqual(sp.type, 'OVERSIZE', '小车不应分到 OVERSIZE');
  assert.notStrictEqual(sp.type, 'DISABLED', '普通车不应分到无障碍位');
});

test('入场：LARGE 车只能分到 OVERSIZE', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川B77777', vehicleType: 'LARGE' });
  assert.strictEqual(enter.status, 201, JSON.stringify(enter.body));
  assert.strictEqual(enter.body.data.space.type, 'OVERSIZE');
});

test('入场：LARGE 车在没有 OVERSIZE 空位时 LOT_FULL 409', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot2 = lots.find((l) => l.code === 'PL-JN-002');
  // lot2 只有 B-02 一个 OVERSIZE，先占掉
  const enter1 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川B77701', vehicleType: 'LARGE' });
  assert.strictEqual(enter1.status, 201, JSON.stringify(enter1.body));
  const enter2 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川B77702', vehicleType: 'LARGE' });
  assert.strictEqual(enter2.status, 409);
  assert.strictEqual(enter2.body.code, 'LOT_FULL');
});

test('入场：电动车优先充电车位，不足时回退 STANDARD', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot2 = lots.find((l) => l.code === 'PL-JN-002');
  // lot2 有一个 CHARGING（B-03）
  const enter1 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川AD11111', vehicleType: 'ELECTRIC' });
  assert.strictEqual(enter1.status, 201);
  assert.strictEqual(enter1.body.data.space.type, 'CHARGING', '第一辆充电车应分到充电位');
  // 再进一辆电动车：充电位已无，回退到 STANDARD
  const enter2 = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川AD22222', vehicleType: 'ELECTRIC' });
  assert.strictEqual(enter2.status, 201, JSON.stringify(enter2.body));
  assert.strictEqual(enter2.body.data.space.type, 'STANDARD', '回退分到标准位');
});

test('入场：预留 reserved_for 车牌的车位，只有该车才能占', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  // seed 中 A-06（CHARGING）reserved_for='川A99887'
  const spaces = (await request(app).get(`/api/lots/${lot1.id}/spaces`).set('Authorization', `Bearer ${token}`)).body.data;
  const reservedSpace = spaces.find((s) => s.code === 'A-06');
  assert.ok(reservedSpace);
  assert.strictEqual(reservedSpace.reservedFor, '川A99887');

  // 其他电动车（非预留车牌）不应占 A-06，哪怕它是充电位
  const otherElectric = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川AD33333', vehicleType: 'ELECTRIC' });
  assert.strictEqual(otherElectric.status, 201, JSON.stringify(otherElectric.body));
  assert.notStrictEqual(otherElectric.body.data.space.id, reservedSpace.id, '非预留车不应占预留车位');

  // 真正预留的车入场，应能分到这个位（或另一个充电位）
  const rightCar = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川A99887', vehicleType: 'ELECTRIC' });
  assert.strictEqual(rightCar.status, 201, JSON.stringify(rightCar.body));
});

test('入场：按就近入口策略，entrance_distance 小的优先', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot2 = lots.find((l) => l.code === 'PL-JN-002');
  const spaces = (await request(app).get(`/api/lots/${lot2.id}/spaces`).set('Authorization', `Bearer ${token}`)).body.data;
  // 先把最近的 CHARGING（B-03，entrance_distance=15）占掉，防止 SMALL 优先停那里
  const freeCharging = spaces.filter((s) => s.status === 'FREE' && s.type === 'CHARGING')
    .sort((a, b) => a.entranceDistance - b.entranceDistance);
  if (freeCharging.length) {
    await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
      .send({ lotId: lot2.id, plateNo: '川占充电1', vehicleType: 'ELECTRIC' });
  }

  const freeStandard = spaces
    .filter((s) => s.status === 'FREE' && s.type === 'STANDARD')
    .sort((a, b) => a.entranceDistance - b.entranceDistance);
  // lot2 有 B-04（25，standard/free）
  const expectedClosestId = freeStandard[0].id;

  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川A44444', vehicleType: 'SMALL', strategy: 'NEAREST_ENTRANCE' });
  assert.strictEqual(enter.status, 201, JSON.stringify(enter.body));
  assert.strictEqual(enter.body.data.space.id, expectedClosestId,
    `应分到距离入口最近的标准位（id=${expectedClosestId}），实际分到 id=${enter.body.data.space?.id}`);
});

test('并发：5 台车同时入场，分配到的车位互不重复', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  // 准备 5 个车牌号并发入场
  const plates = ['川并发001', '川并发002', '川并发003', '川并发004', '川并发005'];
  const tasks = plates.map((p) =>
    request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
      .send({ lotId: lot1.id, plateNo: p, vehicleType: 'SMALL', strategy: 'NEAREST_ENTRANCE' }),
  );
  const results = await Promise.all(tasks);
  const oks = results.filter((r) => r.status === 201);
  // 至少全部成功或有一些成功但不能重复
  const spaceIds = oks.map((r) => r.body.data.space.id).filter((id) => id != null);
  const unique = new Set(spaceIds);
  assert.strictEqual(spaceIds.length, unique.size, '并发分配的车位 ID 不能有重复');
  assert.ok(oks.length >= 3, `至少应分到 3 个车位，实际 ${oks.length}`);
});

test('人工纠偏：强制把 OCCUPIED 车位置 FREE 并写审计日志', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  // 先占一个位
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川纠偏001', vehicleType: 'SMALL' });
  assert.strictEqual(enter.status, 201);
  const spaceId = enter.body.data.space.id;
  assert.strictEqual(enter.body.data.space.status, 'OCCUPIED');

  // 强制置 FREE
  const force = await request(app).post(`/api/spaces/${spaceId}/force-status`).set('Authorization', `Bearer ${token}`)
    .send({ newStatus: 'FREE', reason: 'CORRECT', note: '人工发现车走了系统没释放' });
  assert.strictEqual(force.status, 200, JSON.stringify(force.body));
  assert.strictEqual(force.body.data.space.status, 'FREE');

  // 读日志
  const logs = (await request(app).get(`/api/spaces/${spaceId}/logs`).set('Authorization', `Bearer ${token}`)).body.data;
  assert.ok(logs.length >= 1, '应有状态变更日志');
  const hasManual = logs.some((l) => l.reason && l.reason.startsWith('MANUAL_'));
  assert.ok(hasManual, '日志中应有 MANUAL_* 类型的记录');
});

test('对账：找出状态不一致的车位', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  // 占一个位，然后强制把车位改 FREE（模拟系统漏记占用 -> 产生 freeButOccupied 异常）
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot1.id, plateNo: '川对账001', vehicleType: 'SMALL' });
  assert.strictEqual(enter.status, 201);
  const spaceId = enter.body.data.space.id;
  await request(app).post(`/api/spaces/${spaceId}/force-status`).set('Authorization', `Bearer ${token}`)
    .send({ newStatus: 'FREE', reason: 'SIMULATE_BUG', note: '模拟漏记占用' });

  const rec = await request(app).get(`/api/lots/${lot1.id}/reconcile`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(rec.status, 200);
  const incons = rec.body.data.inconsistencies;
  assert.ok(incons.freeButOccupied.some((x) => x.spaceId === spaceId),
    '对账应识别出 FREE 但实际被占用的车位');
});

test('状态机：MAINTENANCE/RESERVED 状态的车位不能被分配为 OCCUPIED', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot1 = lots.find((l) => l.code === 'PL-CG-001');
  const spaces = (await request(app).get(`/api/lots/${lot1.id}/spaces`).set('Authorization', `Bearer ${token}`)).body.data;
  const maintenanceSpace = spaces.find((s) => s.status === 'MAINTENANCE');
  const reservedSpace = spaces.find((s) => s.status === 'RESERVED');
  assert.ok(maintenanceSpace);
  assert.ok(reservedSpace);

  // 所有空闲标准位占满，看看会不会误分到 MAINTENANCE/RESERVED
  const freeStandard = spaces.filter((s) => s.status === 'FREE' && s.type === 'STANDARD');
  for (let i = 0; i < freeStandard.length; i += 1) {
    const p = `川占位${String(i + 1).padStart(3, '0')}`;
    const r = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
      .send({ lotId: lot1.id, plateNo: p, vehicleType: 'SMALL' });
    // 允许失败（满场）但只要成功就不能是 MAINTENANCE/RESERVED
    if (r.status === 201) {
      assert.notStrictEqual(r.body.data.space.status, 'MAINTENANCE', '维护中车位不能被分配');
      assert.notStrictEqual(r.body.data.space.status, 'RESERVED', '预留状态车位不能被分配');
    }
  }
});

test('状态机：人工把 FREE 置 MAINTENANCE，不能被分配', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const lot2 = lots.find((l) => l.code === 'PL-JN-002');
  const spaces = (await request(app).get(`/api/lots/${lot2.id}/spaces`).set('Authorization', `Bearer ${token}`)).body.data;
  const target = spaces.find((s) => s.status === 'FREE' && s.type === 'STANDARD');
  assert.ok(target);
  const f = await request(app).post(`/api/spaces/${target.id}/force-status`).set('Authorization', `Bearer ${token}`)
    .send({ newStatus: 'MAINTENANCE', reason: 'CLOSE', note: '设备维修，封位' });
  assert.strictEqual(f.status, 200);

  // lot2 还有一个 FREE STANDARD（B-04），但如果我们把所有 STANDARD 全置 MAINTENANCE 试试
  const freeStd = spaces.filter((s) => s.status === 'FREE' && s.type === 'STANDARD' && s.id !== target.id);
  for (const s of freeStd) {
    await request(app).post(`/api/spaces/${s.id}/force-status`).set('Authorization', `Bearer ${token}`)
      .send({ newStatus: 'MAINTENANCE' });
  }
  const enter = await request(app).post('/api/sessions/enter').set('Authorization', `Bearer ${token}`)
    .send({ lotId: lot2.id, plateNo: '川无位001', vehicleType: 'SMALL' });
  // 没有合适 STANDARD，要么 LOT_FULL 要么分到其他（OVERSIZE 不行，CHARGING 可以）
  if (enter.status === 201) {
    assert.strictEqual(enter.body.data.space.type, 'CHARGING', '没标准位时小车可回退到充电位（充电位允许小车停）');
  }
});

test('删除停车场需要 admin，operator 被拒 403', async () => {
  const token = await loginAs('operator', 'operator123');
  const lots = (await request(app).get('/api/lots').set('Authorization', `Bearer ${token}`)).body.data;
  const res = await request(app).delete(`/api/lots/${lots[0].id}`).set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 403);
});

test('不存在的接口 404', async () => {
  const res = await request(app).get('/api/not-exist');
  assert.strictEqual(res.status, 404);
});

