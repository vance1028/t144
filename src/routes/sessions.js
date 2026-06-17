'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole, getCurrentUser } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

/** GET /api/sessions —— 停车记录列表（lotId / plateNo / status 过滤）。 */
router.get('/', async (req, res, next) => {
  try {
    const { lotId, plateNo, status } = req.query;
    const filter = { plateNo, status };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    return sendData(res, 200, await store.listSessions(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    return sendData(res, 200, s);
  } catch (e) { return next(e); }
});

/**
 * POST /api/sessions/enter —— 车辆入场，自动分配车位（并发安全）。
 * body: { lotId, plateNo, vehicleType?, enterTime?, strategy? }
 *   - strategy: NEAREST_ENTRANCE（默认，就近入口） / BALANCED_ZONE（均衡区域）
 *   - 会根据车辆类型自动匹配合适车位（充电车优先充电位、大车去大车位、无障碍留给无障碍车）
 *   - 满场直接返回 409
 */
router.post('/enter', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { lotId, plateNo, vehicleType, enterTime, strategy } = req.body || {};
    if (lotId === undefined || !plateNo) return sendError(res, 400, '停车场和车牌号不能为空');
    const lot = await store.getLotById(Number(lotId));
    if (!lot) return sendError(res, 400, '停车场不存在');
    if (lot.status !== 'OPEN') return sendError(res, 409, '停车场当前未开放');

    const user = getCurrentUser(req);
    const result = await store.allocateSpace({
      lotId: Number(lotId),
      plateNo,
      vehicleType,
      enterTime,
      strategy: strategy || 'NEAREST_ENTRANCE',
      operatorName: user ? user.name : 'SYSTEM',
    });

    if (!result.ok) {
      const statusMap = {
        BAD_REQUEST: 400,
        ALREADY_PARKED: 409,
        LOT_FULL: 409,
      };
      return sendError(res, statusMap[result.code] || 500, result.message || '分配失败', { code: result.code });
    }
    return sendData(res, 201, {
      session: result.session,
      space: result.space,
      allocationStrategy: result.session ? result.session.allocationStrategy : null,
    });
  } catch (e) { return next(e); }
});

/**
 * POST /api/sessions/:id/exit —— 车辆出场，释放车位（并发安全）。
 */
router.post('/:id/exit', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    if (s.status !== 'PARKED') return sendError(res, 409, '该记录已结束，不能重复出场');

    const user = getCurrentUser(req);
    const { exitTime, feeCents, paid } = req.body || {};
    const result = await store.releaseSpace({
      sessionId: id,
      exitTime,
      feeCents: feeCents ?? 0,
      paid: !!paid,
      operatorName: user ? user.name : 'SYSTEM',
    });

    if (!result.ok) {
      const statusMap = { NOT_FOUND: 404, ALREADY_EXITED: 409 };
      return sendError(res, statusMap[result.code] || 500, result.message || '出场失败', { code: result.code });
    }
    return sendData(res, 200, {
      session: result.session,
      space: result.space,
      releaseResult: result.code,
    });
  } catch (e) { return next(e); }
});

module.exports = router;
