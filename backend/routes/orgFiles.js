const router = require('express').Router();
const db     = require('../db');
const auth   = require('../middleware/auth');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

function fixFilename(raw) {
  try { return Buffer.from(raw, 'latin1').toString('utf8'); } catch { return raw; }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    file.originalname = fixFilename(file.originalname);
    const dir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => { req.fileUuid = uuidv4(); cb(null, req.fileUuid); },
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', auth, async (req, res) => {
  if (!req.orgId) return res.status(403).json({ error: 'Вы не состоите в организации' });
  try {
    const r = await db.query(
      `SELECT f.*, u.name AS uploader_name FROM org_files f
       LEFT JOIN users u ON u.id=f.uploaded_by
       WHERE f.org_id=$1 ORDER BY f.created_at DESC`,
      [req.orgId]
    );
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/', auth, upload.single('file'), async (req, res) => {
  if (req.role !== 'admin') { if (req.file?.path) fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Только администратор' }); }
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  try {
    const r = (await db.query(
      `INSERT INTO org_files (org_id,name,size,file_uuid,mime_type,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.orgId, req.file.originalname, req.file.size, req.fileUuid, req.file.mimetype, req.userId]
    )).rows[0];
    const u = await db.query('SELECT name FROM users WHERE id=$1', [req.userId]);
    res.status(201).json({ ...r, uploader_name: u.rows[0]?.name });
  } catch (err) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  if (req.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  try {
    const r = await db.query('SELECT * FROM org_files WHERE id=$1 AND org_id=$2', [req.params.id, req.orgId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Файл не найден' });
    const fp = path.join(__dirname, '..', 'uploads', r.rows[0].file_uuid);
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    await db.query('DELETE FROM org_files WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
