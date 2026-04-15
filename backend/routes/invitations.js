const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');

// ── POST /api/invitations/send ── Администратор отправляет приглашение по invite_code сотрудника
router.post('/send', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Только администратор может приглашать' });
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Укажите код сотрудника' });

  try {
    const userRes = await db.query(
      'SELECT id, name, email, org_id FROM users WHERE invite_code=$1',
      [inviteCode.toUpperCase()]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ error: 'Сотрудник с таким кодом не найден' });

    const target = userRes.rows[0];
    if (target.org_id)
      return res.status(409).json({ error: 'Этот сотрудник уже состоит в организации' });

    // Проверяем нет ли уже активного приглашения
    const existing = await db.query(
      'SELECT id, status FROM invitations WHERE org_id=$1 AND user_id=$2',
      [req.orgId, target.id]
    );
    if (existing.rows.length) {
      if (existing.rows[0].status === 'pending')
        return res.status(409).json({ error: 'Приглашение уже отправлено и ожидает ответа' });
      // Если отклонено ранее — переотправляем
      await db.query('UPDATE invitations SET status=$1, created_at=NOW() WHERE id=$2', ['pending', existing.rows[0].id]);
      return res.json({ ok: true, user: { id: target.id, name: target.name, email: target.email } });
    }

    await db.query('INSERT INTO invitations (org_id, user_id) VALUES ($1,$2)', [req.orgId, target.id]);
    res.status(201).json({ ok: true, user: { id: target.id, name: target.name, email: target.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/invitations/incoming ── Входящие приглашения для сотрудника
router.get('/incoming', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT i.id, i.status, i.created_at, o.name AS org_name, o.code AS org_code, o.id AS org_id
       FROM invitations i JOIN organizations o ON o.id = i.org_id
       WHERE i.user_id=$1 AND i.status='pending'
       ORDER BY i.created_at DESC`,
      [req.userId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/invitations/:id/accept ── Принять приглашение
router.post('/:id/accept', auth, async (req, res) => {
  try {
    const inv = await db.query(
      'SELECT * FROM invitations WHERE id=$1 AND user_id=$2 AND status=$3',
      [req.params.id, req.userId, 'pending']
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Приглашение не найдено' });

    const orgId = inv.rows[0].org_id;

    // Проверяем не вступил ли уже
    const user = await db.query('SELECT org_id FROM users WHERE id=$1', [req.userId]);
    if (user.rows[0].org_id) return res.status(409).json({ error: 'Вы уже состоите в организации' });

    await db.query('UPDATE invitations SET status=$1 WHERE id=$2', ['accepted', req.params.id]);
    await db.query('UPDATE users SET org_id=$1 WHERE id=$2', [orgId, req.userId]);

    // Отклоняем все остальные ожидающие приглашения
    await db.query(
      "UPDATE invitations SET status='rejected' WHERE user_id=$1 AND status='pending' AND id!=$2",
      [req.userId, req.params.id]
    );

    // Возвращаем данные организации чтобы фронт обновил сессию
    const org = await db.query('SELECT * FROM organizations WHERE id=$1', [orgId]);
    res.json({ ok: true, org: org.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/invitations/:id/reject ── Отклонить приглашение
router.post('/:id/reject', auth, async (req, res) => {
  try {
    const r = await db.query(
      'UPDATE invitations SET status=$1 WHERE id=$2 AND user_id=$3 AND status=$4 RETURNING id',
      ['rejected', req.params.id, req.userId, 'pending']
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Приглашение не найдено' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/invitations/sent ── Исходящие приглашения (для admin — список кого пригласили)
router.get('/sent', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const r = await db.query(
      `SELECT i.id, i.status, i.created_at, u.name AS user_name, u.email
       FROM invitations i JOIN users u ON u.id = i.user_id
       WHERE i.org_id=$1
       ORDER BY i.created_at DESC`,
      [req.orgId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
