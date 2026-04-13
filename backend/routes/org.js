const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db     = require('../db');
const auth   = require('../middleware/auth');
const path   = require('path');
const fs     = require('fs');

// GET /api/org/me — текущая организация
router.get('/me', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM organizations WHERE id=$1', [req.orgId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Организация не найдена' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/org/employees — список сотрудников организации
router.get('/employees', auth, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, name, email, role, created_at FROM users WHERE org_id=$1 ORDER BY created_at',
      [req.orgId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/org/employees — добавить сотрудника (только admin)
router.post('/employees', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const exists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email уже занят' });

    const hash = await bcrypt.hash(password, 10);
    const r = await db.query(
      'INSERT INTO users (org_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role',
      [req.orgId, name, email, hash, 'employee']
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/org/employees/:id — удалить сотрудника (только admin)
router.delete('/employees/:id', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  const targetId = parseInt(req.params.id);
  if (targetId === req.userId) return res.status(400).json({ error: 'Нельзя удалить себя' });

  try {
    const check = await db.query('SELECT id FROM users WHERE id=$1 AND org_id=$2', [targetId, req.orgId]);
    if (!check.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });

    await db.query('DELETE FROM users WHERE id=$1', [targetId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// DELETE /api/org — удалить организацию (только admin)
router.delete('/', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });

  try {
    // Находим все внутренние чаты организации (оба участника из одной org)
    const internalChats = await db.query(
      `SELECT DISTINCT c.id FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       JOIN users u ON u.id = cm.user_id
       WHERE c.is_inter_org = FALSE
       GROUP BY c.id
       HAVING COUNT(DISTINCT CASE WHEN u.org_id != $1 THEN 1 END) = 0`,
      [req.orgId]
    );
    const internalChatIds = internalChats.rows.map(r => r.id);

    // Удаляем файлы из uploads для внутренних чатов
    if (internalChatIds.length) {
      const msgs = await db.query(
        `SELECT file_uuid FROM messages WHERE chat_id = ANY($1)`,
        [internalChatIds]
      );
      msgs.rows.forEach(m => deleteUploadedFile(m.file_uuid));

      await db.query('DELETE FROM chats WHERE id = ANY($1)', [internalChatIds]);
    }

    // Удаляем файлы организации
    const orgFiles = await db.query('SELECT file_uuid FROM org_files WHERE org_id=$1', [req.orgId]);
    orgFiles.rows.forEach(f => deleteUploadedFile(f.file_uuid));

    // Каскадное удаление: org -> users -> ...
    await db.query('DELETE FROM organizations WHERE id=$1', [req.orgId]);

    res.json({ ok: true });
  } catch (err) {
    console.error('delete org error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

function deleteUploadedFile(uuid) {
  try {
    const fp = path.join(__dirname, '..', 'uploads', uuid);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch {}
}

module.exports = router;
