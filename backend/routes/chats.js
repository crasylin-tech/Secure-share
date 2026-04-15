const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

// ── Декодирование имени файла из Latin-1 → UTF-8 (multer получает имя в Latin-1)
function fixFilename(raw) {
  try {
    return Buffer.from(raw, 'latin1').toString('utf8');
  } catch {
    return raw;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Имя декодируем здесь, чтобы оно было готово к моменту обработки
    file.originalname = fixFilename(file.originalname);
    const dir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    req.fileUuid = uuidv4();
    cb(null, req.fileUuid);
  },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ── GET /api/chats?interOrg=false ── список моих чатов
router.get('/', auth, async (req, res) => {
  const isInterOrg = req.query.interOrg === 'true';
  try {
    const r = await db.query(
      `SELECT c.id, c.is_inter_org, c.created_at,
              json_agg(json_build_object(
                'userId', u.id, 'name', u.name, 'email', u.email,
                'orgId', u.org_id, 'orgName', o.name
              )) AS members
       FROM chats c
       JOIN chat_members cm ON cm.chat_id = c.id
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN organizations o ON o.id = u.org_id
       WHERE c.is_inter_org = $1
         AND c.id IN (SELECT chat_id FROM chat_members WHERE user_id=$2)
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [isInterOrg, req.userId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/chats ── создать чат
router.post('/', auth, async (req, res) => {
  const { targetUserId, isInterOrg } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'Укажите targetUserId' });
  if (!req.orgId) return res.status(403).json({ error: 'Вы не состоите в организации' });

  try {
    const target = await db.query('SELECT id, org_id FROM users WHERE id=$1', [targetUserId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });

    const targetOrgId = target.rows[0].org_id;
    if (isInterOrg && targetOrgId === req.orgId)
      return res.status(400).json({ error: 'Межорг. чат — только с сотрудником другой организации' });
    if (!isInterOrg && targetOrgId !== req.orgId)
      return res.status(400).json({ error: 'Внутренний чат — только в рамках одной организации' });

    const existing = await db.query(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id=c.id AND cm1.user_id=$1
       JOIN chat_members cm2 ON cm2.chat_id=c.id AND cm2.user_id=$2
       WHERE c.is_inter_org=$3`,
      [req.userId, targetUserId, !!isInterOrg]
    );
    if (existing.rows.length) return res.json({ id: existing.rows[0].id, existing: true });

    const chat = (await db.query(
      'INSERT INTO chats (is_inter_org) VALUES ($1) RETURNING id',
      [!!isInterOrg]
    )).rows[0];
    await db.query('INSERT INTO chat_members (chat_id,user_id) VALUES ($1,$2),($1,$3)', [chat.id, req.userId, targetUserId]);
    res.status(201).json({ id: chat.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/chats/:id/messages ── сообщения чата
router.get('/:id/messages', auth, async (req, res) => {
  const chatId = parseInt(req.params.id);
  try {
    const access = await db.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [chatId, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Нет доступа к этому чату' });

    const r = await db.query(
      `SELECT m.id, m.chat_id, m.sender_id, m.file_name, m.file_size,
              m.file_uuid, m.mime_type, m.created_at, u.name AS sender_name
       FROM messages m LEFT JOIN users u ON u.id=m.sender_id
       WHERE m.chat_id=$1 ORDER BY m.created_at ASC`,
      [chatId]
    );
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/chats/:id/upload ── загрузить файл в чат
router.post('/:id/upload', auth, upload.single('file'), async (req, res) => {
  const chatId = parseInt(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

  try {
    const access = await db.query(
      'SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2',
      [chatId, req.userId]
    );
    if (!access.rows.length) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Нет доступа к этому чату' });
    }

    const r = (await db.query(
      `INSERT INTO messages (chat_id, sender_id, file_name, file_size, file_uuid, mime_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [chatId, req.userId, req.file.originalname, req.file.size, req.fileUuid, req.file.mimetype]
    )).rows[0];

    const user = await db.query('SELECT name FROM users WHERE id=$1', [req.userId]);
    res.status(201).json({ ...r, sender_name: user.rows[0]?.name });
  } catch (err) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/chats/file/:uuid ── скачать файл (с правильным именем)
router.get('/file/:uuid', auth, async (req, res) => {
  const uuid = req.params.uuid;
  try {
    const msgCheck = await db.query(
      `SELECT m.file_name, m.mime_type FROM messages m
       JOIN chat_members cm ON cm.chat_id=m.chat_id AND cm.user_id=$1
       WHERE m.file_uuid=$2`,
      [req.userId, uuid]
    );
    const orgCheck = await db.query(
      `SELECT name AS file_name, mime_type FROM org_files
       WHERE file_uuid=$1 AND org_id=$2`,
      [uuid, req.orgId]
    );
    const meta = msgCheck.rows[0] || orgCheck.rows[0];
    if (!meta) return res.status(403).json({ error: 'Доступ запрещён или файл не найден' });

    const filePath = path.join(__dirname, '..', 'uploads', uuid);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Файл не найден на диске' });

    // RFC 5987: корректная передача UTF-8 имени файла в заголовке
    const encoded = encodeURIComponent(meta.file_name).replace(/'/g, '%27');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
    res.setHeader('Content-Type', meta.mime_type || 'application/octet-stream');
    res.sendFile(path.resolve(filePath));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/chats/users/search ── поиск пользователей для создания чата
router.get('/users/search', auth, async (req, res) => {
  if (!req.orgId) return res.status(403).json({ error: 'Вы не состоите в организации' });
  const { orgId, q } = req.query;
  try {
    let r;
    if (orgId) {
      r = await db.query(
        `SELECT id, name, email, org_id FROM users
         WHERE org_id=$1 AND id!=$2 AND (LOWER(name) LIKE $3 OR LOWER(email) LIKE $3) LIMIT 20`,
        [parseInt(orgId), req.userId, `%${(q||'').toLowerCase()}%`]
      );
    } else {
      r = await db.query(
        `SELECT u.id, u.name, u.email, u.org_id, o.name AS org_name
         FROM users u JOIN organizations o ON o.id=u.org_id
         WHERE u.org_id!=$1 AND (LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2 OR LOWER(o.name) LIKE $2) LIMIT 20`,
        [req.orgId, `%${(q||'').toLowerCase()}%`]
      );
    }
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
