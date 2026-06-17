'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole, getCurrentUser } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

/** GET /api/spaces —— 车位列表（lotId / status / type 过滤）。 */
router.get('/', async (req, res, next) => {
  try {
    const { lotId, status, type } = req.query;
    const filter = { status, type };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    return sendData(res, 200, await store.listSpaces(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const space = await store.getSpaceById(id);
    if (!space) return sendError(res, 404, '车位不存在');
    return sendData(res, 200, space);
  } catch (e) { return next(e); }
});

/** GET /api/spaces/:id/logs —— 某车位的状态变更审计日志。 */
router.get('/:id/logs', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getSpaceById(id))) return sendError(res, 404, '车位不存在');
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    return sendData(res, 200, await store.listStatusLogs({ spaceId: id, limit }));
  } catch (e) { return next(e); }
});

/**
 * POST /api/spaces/:id/force-status —— 人工强制改车位状态（纠偏）。
 * body: { newStatus, reason?, note?, sessionId?, plateNo? }
 * newStatus: FREE / OCCUPIED / RESERVED / MAINTENANCE
 */
router.post('/:id/force-status', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getSpaceById(id))) return sendError(res, 404, '车位不存在');
    const { newStatus, reason, note, sessionId, plateNo } = req.body || {};
    if (!newStatus) return sendError(res, 400, 'newStatus 不能为空');
    const user = getCurrentUser(req);
    const result = await store.forceUpdateSpaceStatus({
      spaceId: id,
      newStatus,
      reason: reason || 'CORRECT',
      note,
      sessionId: sessionId !== undefined ? Number(sessionId) : undefined,
      plateNo,
      operatorName: user ? user.name : 'SYSTEM',
    });
    if (!result.ok) {
      const statusMap = { BAD_REQUEST: 400, NOT_FOUND: 404 };
      return sendError(res, statusMap[result.code] || 500, result.message || '更新失败', { code: result.code });
    }
    return sendData(res, 200, { space: result.space, result: result.code });
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getSpaceById(id))) return sendError(res, 404, '车位不存在');
    return sendData(res, 200, await store.updateSpace(id, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getSpaceById(id))) return sendError(res, 404, '车位不存在');
    await store.deleteSpace(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

module.exports = router;
