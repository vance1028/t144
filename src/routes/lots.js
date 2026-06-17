'use strict';

const express = require('express');
const store = require('../data/store');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

/** GET /api/lots —— 停车场列表（district / status / keyword 过滤）。 */
router.get('/', async (req, res, next) => {
  try {
    const { district, status, keyword } = req.query;
    return sendData(res, 200, await store.listLots({ district, status, keyword }));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const lot = await store.getLotById(id);
    if (!lot) return sendError(res, 404, '停车场不存在');
    return sendData(res, 200, lot);
  } catch (e) { return next(e); }
});

/** GET /api/lots/:id/spaces —— 某停车场的车位列表。 */
router.get('/:id/spaces', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getLotById(id))) return sendError(res, 404, '停车场不存在');
    return sendData(res, 200, await store.listSpaces({ lotId: id }));
  } catch (e) { return next(e); }
});

/**
 * GET /api/lots/:id/reconcile —— 对账：列出该停车场车位状态与 session 的差异（人工巡检用）。
 * 输出：
 *   - statusCounts：各状态车位数
 *   - freeButOccupied：系统显示 FREE/RESERVED/MAINTENANCE 但实际被 session 占用的异常
 *   - occupiedButFree：系统显示 OCCUPIED 但没有对应 PARKED session 的异常
 *   - crossWrong：预留车牌与实际占用车牌不一致的异常
 */
router.get('/:id/reconcile', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getLotById(id))) return sendError(res, 404, '停车场不存在');
    return sendData(res, 200, await store.reconcileSpaces(id));
  } catch (e) { return next(e); }
});

/** POST /api/lots/:id/spaces —— 在某停车场下新建车位。 */
router.post('/:id/spaces', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getLotById(id))) return sendError(res, 404, '停车场不存在');
    const { code } = req.body || {};
    if (!code) return sendError(res, 400, '车位编号不能为空');
    if (await store.getSpaceByCode(id, code)) return sendError(res, 409, '该停车场内车位编号已存在');
    return sendData(res, 201, await store.createSpace({ ...req.body, lotId: id }));
  } catch (e) { return next(e); }
});

router.post('/', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { code, name, district } = req.body || {};
    if (!code || !name || !district) return sendError(res, 400, '编号、名称、区域不能为空');
    if (await store.getLotByCode(code)) return sendError(res, 409, '停车场编号已存在');
    return sendData(res, 201, await store.createLot(req.body));
  } catch (e) { return next(e); }
});

router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getLotById(id))) return sendError(res, 404, '停车场不存在');
    return sendData(res, 200, await store.updateLot(id, req.body || {}));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getLotById(id))) return sendError(res, 404, '停车场不存在');
    await store.deleteLot(id);
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

module.exports = router;
