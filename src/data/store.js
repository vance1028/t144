'use strict';

const { getPool } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：所有 SQL 集中在这里，路由层只调用这些 async 方法。
 * 对外返回 camelCase 字段对象。
 */

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role,
    status: r.status, createdAt: r.created_at,
  };
}
function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}
function mapLot(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, name: r.name, district: r.district, address: r.address,
    totalSpaces: r.total_spaces, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSpace(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, code: r.code, type: r.type, status: r.status,
    zone: r.zone, entranceDistance: r.entrance_distance,
    isReserved: !!r.is_reserved, reservedFor: r.reserved_for,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapVehicle(r) {
  if (!r) return null;
  return {
    id: r.id, plateNo: r.plate_no, ownerName: r.owner_name, phone: r.phone,
    vehicleType: r.vehicle_type, isMember: !!r.is_member, createdAt: r.created_at,
  };
}
function mapSession(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, spaceId: r.space_id, plateNo: r.plate_no,
    enterTime: r.enter_time, exitTime: r.exit_time, feeCents: r.fee_cents,
    status: r.status, paid: !!r.paid, allocationStrategy: r.allocation_strategy,
    createdAt: r.created_at,
  };
}
function mapStatusLog(r) {
  if (!r) return null;
  return {
    id: r.id, spaceId: r.space_id, lotId: r.lot_id,
    oldStatus: r.old_status, newStatus: r.new_status, reason: r.reason,
    plateNo: r.plate_no, sessionId: r.session_id,
    operatorName: r.operator_name, note: r.note, createdAt: r.created_at,
  };
}

/* ----------------------------- 用户 ----------------------------- */

async function getUserByUsername(username) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}
async function getUserById(id) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}
async function listUsers() {
  const [rows] = await getPool().query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}
async function createUser({ username, password, name, role = 'VIEWER', status = 'ACTIVE' }) {
  const [r] = await getPool().query(
    'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, status],
  );
  return getUserById(r.insertId);
}
async function updateUser(id, fields) {
  const map = { name: 'name', role: 'role', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { sets.push(`${col} = ?`); params.push(fields[k]); }
  }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getUserById(id);
}
async function deleteUser(id) {
  const [r] = await getPool().query('DELETE FROM users WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function countUsers() {
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}

/* ----------------------------- 停车场 ----------------------------- */

async function listLots({ district, status, keyword } = {}) {
  const where = []; const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(code LIKE ? OR name LIKE ? OR address LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_lots ${clause} ORDER BY id DESC`, params);
  return rows.map(mapLot);
}
async function getLotById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE id = ?', [id]);
  return mapLot(rows[0]);
}
async function getLotByCode(code) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE code = ?', [code]);
  return mapLot(rows[0]);
}
async function createLot(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_lots (code, name, district, address, total_spaces, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.code, d.name, d.district, d.address || '', d.totalSpaces || 0, d.status || 'OPEN'],
  );
  return getLotById(r.insertId);
}
async function updateLot(id, d) {
  const map = { name: 'name', district: 'district', address: 'address', totalSpaces: 'total_spaces', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_lots SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getLotById(id);
}
async function deleteLot(id) {
  const [r] = await getPool().query('DELETE FROM parking_lots WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车位 ----------------------------- */

async function listSpaces({ lotId, status, type } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_spaces ${clause} ORDER BY id`, params);
  return rows.map(mapSpace);
}
async function getSpaceById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [id]);
  return mapSpace(rows[0]);
}
async function getSpaceByCode(lotId, code) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE lot_id = ? AND code = ?', [lotId, code]);
  return mapSpace(rows[0]);
}
async function createSpace(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_spaces (lot_id, code, type, status, zone, entrance_distance, is_reserved, reserved_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.lotId, d.code, d.type || 'STANDARD', d.status || 'FREE',
      d.zone || 'DEFAULT', d.entranceDistance ?? 0,
      d.isReserved ? 1 : 0, d.reservedFor ?? null,
    ],
  );
  return getSpaceById(r.insertId);
}
async function updateSpace(id, d) {
  const map = {
    type: 'type', status: 'status', zone: 'zone',
    entranceDistance: 'entrance_distance', reservedFor: 'reserved_for',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isReserved !== undefined) { sets.push('is_reserved = ?'); params.push(d.isReserved ? 1 : 0); }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_spaces SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getSpaceById(id);
}
async function deleteSpace(id) {
  const [r] = await getPool().query('DELETE FROM parking_spaces WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车辆 ----------------------------- */

async function listVehicles({ keyword, isMember } = {}) {
  const where = []; const params = [];
  if (keyword) { where.push('(plate_no LIKE ? OR owner_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k); }
  if (isMember !== undefined) { where.push('is_member = ?'); params.push(isMember ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM vehicles ${clause} ORDER BY id DESC`, params);
  return rows.map(mapVehicle);
}
async function getVehicleById(id) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE id = ?', [id]);
  return mapVehicle(rows[0]);
}
async function getVehicleByPlate(plateNo) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE plate_no = ?', [plateNo]);
  return mapVehicle(rows[0]);
}
async function createVehicle(d) {
  const [r] = await getPool().query(
    'INSERT INTO vehicles (plate_no, owner_name, phone, vehicle_type, is_member) VALUES (?, ?, ?, ?, ?)',
    [d.plateNo, d.ownerName || '', d.phone || '', d.vehicleType || 'SMALL', d.isMember ? 1 : 0],
  );
  return getVehicleById(r.insertId);
}
async function updateVehicle(id, d) {
  const map = { ownerName: 'owner_name', phone: 'phone', vehicleType: 'vehicle_type' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isMember !== undefined) { sets.push('is_member = ?'); params.push(d.isMember ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getVehicleById(id);
}
async function deleteVehicle(id) {
  const [r] = await getPool().query('DELETE FROM vehicles WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 停车记录 ----------------------------- */

async function listSessions({ lotId, plateNo, status } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_sessions ${clause} ORDER BY id DESC`, params);
  return rows.map(mapSession);
}
async function getSessionById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [id]);
  return mapSession(rows[0]);
}
async function createSession(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_sessions (lot_id, space_id, plate_no, enter_time, status, allocation_strategy)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      d.lotId, d.spaceId ?? null, d.plateNo, d.enterTime,
      d.status || 'PARKED', d.allocationStrategy || 'MANUAL',
    ],
  );
  return getSessionById(r.insertId);
}
async function updateSession(id, d) {
  const map = {
    spaceId: 'space_id', exitTime: 'exit_time', feeCents: 'fee_cents',
    status: 'status', allocationStrategy: 'allocation_strategy',
  };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.paid !== undefined) { sets.push('paid = ?'); params.push(d.paid ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE parking_sessions SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getSessionById(id);
}

/* ----------------------------- 车位状态变更审计日志 ----------------------------- */

async function insertStatusLog(conn, { spaceId, lotId, oldStatus, newStatus, reason, plateNo, sessionId, operatorName, note }) {
  await conn.query(
    `INSERT INTO space_status_logs (space_id, lot_id, old_status, new_status, reason, plate_no, session_id, operator_name, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      spaceId, lotId, oldStatus, newStatus, reason, plateNo ?? null,
      sessionId ?? null, operatorName || 'SYSTEM', note ?? null,
    ],
  );
}

async function listStatusLogs({ spaceId, lotId, reason, limit = 200 } = {}) {
  const where = []; const params = [];
  if (spaceId !== undefined) { where.push('space_id = ?'); params.push(spaceId); }
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (reason) { where.push('reason = ?'); params.push(reason); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(
    `SELECT * FROM space_status_logs ${clause} ORDER BY id DESC LIMIT ?`,
    [...params, limit],
  );
  return rows.map(mapStatusLog);
}

/* ----------------------------- 策略层：车型匹配与排序规则 ----------------------------- */

const VEHICLE_TYPE_ALLOWED_SPACE = {
  SMALL:    ['STANDARD', 'CHARGING', 'DISABLED'],
  ELECTRIC: ['CHARGING', 'STANDARD'],
  LARGE:    ['OVERSIZE'],
  DISABLED: ['DISABLED', 'STANDARD'],
};

function buildTypeFilter(vehicleType) {
  const allowed = VEHICLE_TYPE_ALLOWED_SPACE[vehicleType];
  if (!allowed) return null;
  return allowed;
}

function buildOrderBy(strategy) {
  switch (strategy) {
    case 'BALANCED_ZONE':
      // 先按区域内已占用率升序（通过分区计数的窗口函数模拟），再按距离入口升序
      return `ORDER BY zone_count ASC, entrance_distance ASC, id ASC`;
    case 'NEAREST_ENTRANCE':
    default:
      return `ORDER BY entrance_distance ASC, id ASC`;
  }
}

/* ----------------------------- 策略层：车位预选（SQL 构造） ----------------------------- */

function buildCandidateQuery({ lotId, vehicleType, isMember, plateNo, strategy, allowDisabled = false, allowReserved = false }) {
  const where = ['lot_id = ?', "status = 'FREE'"];
  const params = [lotId];

  // 1. 车型匹配
  const allowedTypes = buildTypeFilter(vehicleType);
  if (allowedTypes) {
    if (vehicleType === 'DISABLED' || allowDisabled) {
      where.push(`type IN (${allowedTypes.map(() => '?').join(', ')})`);
      params.push(...allowedTypes);
    } else {
      // 非无障碍车不能占无障碍车位
      const noDisabled = allowedTypes.filter((t) => t !== 'DISABLED');
      if (noDisabled.length) {
        where.push(`type IN (${noDisabled.map(() => '?').join(', ')})`);
        params.push(...noDisabled);
      } else {
        return null;
      }
    }
  }

  // 2. 充电车优先充电位：先查充电位，不够再回退
  // 3. 预留车位判断：月卡/预约 reserved_for 匹配才能占；普通 is_reserved=1 且 reserved_for=null 只给会员
  where.push(
    `(is_reserved = 0 OR (is_reserved = 1 AND (
       (reserved_for IS NOT NULL AND reserved_for = ?) OR
       (reserved_for IS NULL AND ? = 1)
     ))${allowReserved ? ' OR 1=0' : ''})`
  );
  params.push(plateNo || '', isMember ? 1 : 0);

  const typeCondition = allowedTypes ? `AND type IN (${allowedTypes.map(() => '?').join(', ')})` : '';
  const typeParams = allowedTypes || [];

  // 子查询：各区域占用数（用于均衡策略）
  const withZoneCount = `
    SELECT s.*,
           (SELECT COUNT(*) FROM parking_spaces z
             WHERE z.lot_id = s.lot_id AND z.zone = s.zone AND z.status = 'OCCUPIED') AS zone_count
      FROM parking_spaces s
  `;

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const orderClause = buildOrderBy(strategy);

  return {
    sql: `${withZoneCount} ${whereClause} ${orderClause} LIMIT 100`,
    params: [...params, ...typeParams],
  };
}

/* ----------------------------- 核心：并发安全的车位分配 ----------------------------- */

/**
 * 分配车位（并发安全）
 * 机制：
 *   1) 开事务（SERIALIZABLE/REPEATABLE READ 均可，靠行锁与条件更新兜底）
 *   2) SELECT ... FOR UPDATE SKIP LOCKED 挑候选（拿到就锁住，被别人锁的跳过，绝不互相等）
 *   3) 用 UPDATE ... WHERE id=? AND status='FREE' 做乐观/悲观双重兜底
 *   4) 写入审计日志、创建 session、提交
 *   5) 没拿到就重试下一个候选；所有候选扫完返回 FULL
 * @returns {{ ok: boolean, code: string, message?: string, session?: object, space?: object }}
 */
async function allocateSpace({ lotId, plateNo, vehicleType, isMember = false, enterTime, strategy = 'NEAREST_ENTRANCE', operatorName = 'SYSTEM', allowDisabled = false }) {
  if (!lotId || !plateNo) return { ok: false, code: 'BAD_REQUEST', message: 'lotId 与 plateNo 必填' };

  const vehicle = await getVehicleByPlate(plateNo);
  const effVehicleType = vehicleType || (vehicle ? vehicle.vehicleType : 'SMALL');
  const effIsMember = isMember || (vehicle ? vehicle.isMember : false);

  // 分两批：充电车先查充电位，再回退到其他
  const candidates = [];
  if (effVehicleType === 'ELECTRIC') {
    candidates.push({ typeBias: 'CHARGING_FIRST', label: 'CHARGING' });
  }
  candidates.push({ typeBias: 'ANY', label: 'ANY' });

  const conn = await getPool().getConnection();
  try {
    // 先设隔离级别（必须在 START TRANSACTION 之前），READ COMMITTED 降低死锁概率
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.query('START TRANSACTION');

    // 同车牌若已有未结束记录，直接拒绝
    const [active] = await conn.query(
      "SELECT id, space_id FROM parking_sessions WHERE plate_no = ? AND status = 'PARKED' LIMIT 1",
      [plateNo],
    );
    if (active.length > 0) {
      await conn.query('ROLLBACK');
      return { ok: false, code: 'ALREADY_PARKED', message: '该车已在场内，不能重复入场', sessionId: active[0].id };
    }

    for (let ci = 0; ci < candidates.length; ci += 1) {
      const c = candidates[ci];
      const allowedTypes = buildTypeFilter(effVehicleType);
      if (!allowedTypes) continue;
      let pickTypes = allowedTypes;
      if (c.typeBias === 'CHARGING_FIRST') pickTypes = allowedTypes.filter((t) => t === 'CHARGING');
      if (pickTypes.length === 0) continue;

      const where = ["s.lot_id = ?", "s.status = 'FREE'"];
      const params = [lotId];
      where.push(`s.type IN (${pickTypes.map(() => '?').join(', ')})`);
      params.push(...pickTypes);

      // 无障碍车才能占无障碍位
      if (effVehicleType !== 'DISABLED' && !allowDisabled && pickTypes.includes('DISABLED')) {
        where.push("s.type <> 'DISABLED'");
      }

      // 预留规则：reserved_for=车牌直接放行；reserved_for=null 且 is_reserved=1 只给会员
      where.push(`(s.is_reserved = 0 OR (s.is_reserved = 1 AND (
         (s.reserved_for IS NOT NULL AND s.reserved_for = ?) OR
         (s.reserved_for IS NULL AND ? = 1)
       )))`);
      params.push(plateNo, effIsMember ? 1 : 0);

      const orderClause = buildOrderBy(strategy);

      // 乐观并发：无锁 SELECT 取 50 个候选（按策略排序），
      // 逐个用 UPDATE WHERE id=? AND status='FREE' 原子尝试，成功第一个即可。
      // 并发下多个事务同时选到同一行时，条件更新的原子性保证只有一个能成功，其余的 affectedRows=0 继续试下一个。
      // 这样不需要 SKIP LOCKED，兼容 MySQL 5.7/8.0/MariaDB 等。
      const candidateSql = `
        SELECT s.id, s.lot_id, s.code, s.type, s.status, s.zone, s.is_reserved, s.reserved_for
          FROM parking_spaces s FORCE INDEX (idx_lot_status_type)
         WHERE ${where.join(' AND ')}
         ${orderClause}
         LIMIT 50
      `;
      const [rows] = await conn.query(candidateSql, params);

      // 逐行尝试条件更新（保证 status 确实还是 FREE 才改成 OCCUPIED），再选第一个成功的
      // 并发重试：最多重试 3 轮（一轮的候选都被抢光就再 SELECT 一次）
      let picked = null;
      for (const row of rows) {
        const [upd] = await conn.query(
          `UPDATE parking_spaces SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP(3)
            WHERE id = ? AND status = 'FREE'`,
          [row.id],
        );
        if (upd.affectedRows === 1) { picked = row; break; }
      }

      if (!picked) continue;

      // 写 session
      const [ins] = await conn.query(
        `INSERT INTO parking_sessions (lot_id, space_id, plate_no, enter_time, status, allocation_strategy)
         VALUES (?, ?, ?, ?, 'PARKED', ?)`,
        [
          lotId, picked.id, plateNo,
          enterTime || new Date().toISOString().slice(0, 19).replace('T', ' '),
          strategy,
        ],
      );

      // 写审计日志
      await insertStatusLog(conn, {
        spaceId: picked.id, lotId, oldStatus: 'FREE', newStatus: 'OCCUPIED',
        reason: 'ALLOCATE', plateNo, sessionId: ins.insertId, operatorName,
        note: `策略=${strategy}, 车型=${effVehicleType}, 批次=${c.label}`,
      });

      await conn.query('COMMIT');

      const [spRow] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [picked.id]);
      const [seRow] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [ins.insertId]);
      return {
        ok: true, code: 'OK',
        space: mapSpace(spRow[0]),
        session: mapSession(seRow[0]),
      };
    }

    await conn.query('ROLLBACK');
    return { ok: false, code: 'LOT_FULL', message: '停车场已满，没有合适的空闲车位' };
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 核心：并发安全的车位释放 ----------------------------- */

/**
 * 释放车位（出场）
 * 机制：事务内用条件更新 + 行锁，保证释放与占用交叉时状态不串
 * 只有该 space 当前确实被该 session 占用（即 session.status='PARKED' 且 session.space_id = space.id）
 * 且 space.status='OCCUPIED' 才会把 space 改回 FREE
 */
async function releaseSpace({ sessionId, exitTime, feeCents = 0, paid = false, operatorName = 'SYSTEM' }) {
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.query('START TRANSACTION');

    // 读 session 并加行锁
    const [ses] = await conn.query(
      "SELECT * FROM parking_sessions WHERE id = ? FOR UPDATE",
      [sessionId],
    );
    if (!ses.length) { await conn.query('ROLLBACK'); return { ok: false, code: 'NOT_FOUND', message: '停车记录不存在' }; }
    const session = ses[0];

    if (session.status !== 'PARKED') {
      await conn.query('ROLLBACK');
      return { ok: false, code: 'ALREADY_EXITED', message: '该记录已结束，不能重复出场' };
    }

    const spaceId = session.space_id;
    let spaceRow = null;
    if (spaceId) {
      const [sp] = await conn.query(
        "SELECT * FROM parking_spaces WHERE id = ? FOR UPDATE",
        [spaceId],
      );
      spaceRow = sp[0] || null;
    }

    // 条件更新：只有 space 当前是 OCCUPIED 才释放回 FREE
    let releaseOk = false;
    if (spaceRow) {
      const [upd] = await conn.query(
        `UPDATE parking_spaces SET status = 'FREE', updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ? AND status = 'OCCUPIED'`,
        [spaceId],
      );
      releaseOk = upd.affectedRows === 1;

      // 审计日志
      await insertStatusLog(conn, {
        spaceId, lotId: session.lot_id,
        oldStatus: releaseOk ? 'OCCUPIED' : spaceRow.status, newStatus: 'FREE',
        reason: releaseOk ? 'RELEASE' : 'FORCE_RELEASE',
        plateNo: session.plate_no, sessionId, operatorName,
        note: releaseOk ? '正常出场释放' : `原状态为 ${spaceRow.status}，强制回 FREE`,
      });
    }

    // 更新 session
    await conn.query(
      `UPDATE parking_sessions
          SET exit_time = ?, fee_cents = ?, status = 'FINISHED', paid = ?
        WHERE id = ?`,
      [
        exitTime || new Date().toISOString().slice(0, 19).replace('T', ' '),
        feeCents, paid ? 1 : 0, sessionId,
      ],
    );

    await conn.query('COMMIT');

    const [finalSession] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [sessionId]);
    const [finalSpace] = spaceId ? await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [spaceId]) : [[null]];
    return {
      ok: true, code: releaseOk ? 'OK' : 'FORCE_OK',
      session: mapSession(finalSession[0]),
      space: mapSpace(finalSpace[0]),
    };
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 人工纠偏：强制改状态 ----------------------------- */

const VALID_SPACE_STATUSES = ['FREE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'];

async function forceUpdateSpaceStatus({ spaceId, newStatus, reason = 'MANUAL', plateNo, sessionId, operatorName = 'SYSTEM', note }) {
  if (!VALID_SPACE_STATUSES.includes(newStatus)) {
    return { ok: false, code: 'BAD_REQUEST', message: `非法状态，必须是 ${VALID_SPACE_STATUSES.join('/')}` };
  }
  const conn = await getPool().getConnection();
  try {
    await conn.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await conn.query('START TRANSACTION');

    const [cur] = await conn.query("SELECT * FROM parking_spaces WHERE id = ? FOR UPDATE", [spaceId]);
    if (!cur.length) { await conn.query('ROLLBACK'); return { ok: false, code: 'NOT_FOUND', message: '车位不存在' }; }
    const old = cur[0];
    if (old.status === newStatus) {
      await conn.query('ROLLBACK');
      const [r] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [spaceId]);
      return { ok: true, code: 'NO_CHANGE', space: mapSpace(r[0]) };
    }

    await conn.query(
      `UPDATE parking_spaces SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [newStatus, spaceId],
    );
    await insertStatusLog(conn, {
      spaceId, lotId: old.lot_id, oldStatus: old.status, newStatus,
      reason: `MANUAL_${reason || 'CORRECT'}`, plateNo, sessionId, operatorName, note,
    });
    await conn.query('COMMIT');
    const [r] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [spaceId]);
    return { ok: true, code: 'OK', space: mapSpace(r[0]) };
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

/* ----------------------------- 对账：找出车位状态与 session 不一致的记录 ----------------------------- */

async function reconcileSpaces(lotId) {
  const conn = await getPool().getConnection();
  try {
    // 1) 系统显示 FREE，但存在对应 PARKED session 的异常（漏记占用）
    const [freeButOccupied] = await conn.query(
      `SELECT s.id AS space_id, s.code, s.status,
              ps.id AS session_id, ps.plate_no, ps.enter_time
         FROM parking_spaces s
         JOIN parking_sessions ps
           ON ps.space_id = s.id AND ps.status = 'PARKED'
        WHERE s.lot_id = ? AND s.status IN ('FREE', 'RESERVED', 'MAINTENANCE')`,
      [lotId],
    );

    // 2) 系统显示 OCCUPIED，但没有任何 PARKED session 占用的异常（漏记释放）
    const [occupiedButFree] = await conn.query(
      `SELECT s.id AS space_id, s.code, s.status
         FROM parking_spaces s
        WHERE s.lot_id = ? AND s.status = 'OCCUPIED'
          AND NOT EXISTS (SELECT 1 FROM parking_sessions ps
                           WHERE ps.space_id = s.id AND ps.status = 'PARKED')`,
      [lotId],
    );

    // 3) 车位被 session 占用，但车牌号与 session 车牌不一致（交叉占错）
    const [crossWrong] = await conn.query(
      `SELECT s.id AS space_id, s.code, s.is_reserved, s.reserved_for,
              ps.id AS session_id, ps.plate_no
         FROM parking_spaces s
         JOIN parking_sessions ps ON ps.space_id = s.id AND ps.status = 'PARKED'
        WHERE s.lot_id = ? AND s.is_reserved = 1
          AND s.reserved_for IS NOT NULL AND s.reserved_for <> ps.plate_no`,
      [lotId],
    );

    const [totals] = await conn.query(
      `SELECT status, COUNT(*) AS n FROM parking_spaces WHERE lot_id = ? GROUP BY status`,
      [lotId],
    );

    return {
      lotId,
      statusCounts: totals.reduce((acc, r) => { acc[r.status] = r.n; return acc; }, {}),
      inconsistencies: {
        freeButOccupied: freeButOccupied.map((r) => ({
          spaceId: r.space_id, code: r.code, actualStatus: r.status,
          sessionId: r.session_id, plateNo: r.plate_no, enterTime: r.enter_time,
          suggestedFix: '将车位强制置为 OCCUPIED',
        })),
        occupiedButFree: occupiedButFree.map((r) => ({
          spaceId: r.space_id, code: r.code, actualStatus: r.status,
          suggestedFix: '将车位强制置为 FREE',
        })),
        crossWrong: crossWrong.map((r) => ({
          spaceId: r.space_id, code: r.code,
          reservedFor: r.reserved_for, actualPlateNo: r.plate_no, sessionId: r.session_id,
          suggestedFix: '人工确认后分别改状态或改预留车牌',
        })),
      },
    };
  } finally {
    conn.release();
  }
}

module.exports = {
  mapUser, mapLot, mapSpace, mapVehicle, mapSession, mapStatusLog,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listLots, getLotById, getLotByCode, createLot, updateLot, deleteLot,
  listSpaces, getSpaceById, getSpaceByCode, createSpace, updateSpace, deleteSpace,
  listVehicles, getVehicleById, getVehicleByPlate, createVehicle, updateVehicle, deleteVehicle,
  listSessions, getSessionById, createSession, updateSession,
  listStatusLogs, allocateSpace, releaseSpace, forceUpdateSpaceStatus, reconcileSpaces,
  VALID_SPACE_STATUSES, VEHICLE_TYPE_ALLOWED_SPACE,
};
