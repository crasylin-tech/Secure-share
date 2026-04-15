const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const auth    = require('../middleware/auth');

function genCode(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ── POST /api/auth/register-org ── Регистрация организации (создаёт admin)
router.post('/register-org', async (req, res) => {
  const { orgName, name, email, password } = req.body;
  if (!orgName || !name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль не менее 6 символов' });

  try {
    if ((await db.query('SELECT id FROM organizations WHERE LOWER(name)=LOWER($1)', [orgName])).rows.length)
      return res.status(409).json({ error: 'Организация с таким названием уже существует' });
    if ((await db.query('SELECT id FROM users WHERE email=$1', [email])).rows.length)
      return res.status(409).json({ error: 'Email уже занят' });

    let orgCode = genCode('ORG');
    while ((await db.query('SELECT id FROM organizations WHERE code=$1', [orgCode])).rows.length)
      orgCode = genCode('ORG');

    const org = (await db.query(
      'INSERT INTO organizations (name, code) VALUES ($1,$2) RETURNING *',
      [orgName, orgCode]
    )).rows[0];

    const hash = await bcrypt.hash(password, 10);
    const user = (await db.query(
      `INSERT INTO users (org_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin') RETURNING id,name,email,role,org_id`,
      [org.id, name, email, hash]
    )).rows[0];

    const token = jwt.sign({ userId: user.id, orgId: org.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: org.id }, org });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/auth/register-employee ── Самостоятельная регистрация сотрудника
// Создаёт аккаунт БЕЗ организации. Организацию присвоит администратор через приглашение.
router.post('/register-employee', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль не менее 6 символов' });

  try {
    if ((await db.query('SELECT id FROM users WHERE email=$1', [email])).rows.length)
      return res.status(409).json({ error: 'Email уже занят' });

    // Личный invite_code сотрудника — уникальный, сотрудник передаёт его администратору
    let inviteCode = genCode('EMP');
    while ((await db.query('SELECT id FROM users WHERE invite_code=$1', [inviteCode])).rows.length)
      inviteCode = genCode('EMP');

    const hash = await bcrypt.hash(password, 10);
    const user = (await db.query(
      `INSERT INTO users (org_id, name, email, password_hash, role, invite_code)
       VALUES (NULL,$1,$2,$3,'employee',$4) RETURNING id,name,email,role,org_id,invite_code`,
      [name, email, hash, inviteCode]
    )).rows[0];

    // Сотрудник без организации — token выдаём, но orgId=null
    const token = jwt.sign({ userId: user.id, orgId: null, role: 'employee' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: null, inviteCode: user.invite_code },
      org: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── POST /api/auth/login ── Вход для всех (admin и employee)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Введите email и пароль' });

  try {
    const r = await db.query(
      `SELECT u.*, o.name AS org_name, o.code AS org_code
       FROM users u LEFT JOIN organizations o ON o.id = u.org_id
       WHERE u.email=$1`,
      [email]
    );
    if (!r.rows.length) return res.status(401).json({ error: 'Пользователь не найден' });
    const user = r.rows[0];

    if (!await bcrypt.compare(password, user.password_hash))
      return res.status(401).json({ error: 'Неверный пароль' });

    const token = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const org = user.org_id
      ? { id: user.org_id, name: user.org_name, code: user.org_code }
      : null;

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id, inviteCode: user.invite_code },
      org,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ── GET /api/auth/me ── Обновить сессию (после принятия приглашения org меняется)
router.get('/me', auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.*, o.name AS org_name, o.code AS org_code
       FROM users u LEFT JOIN organizations o ON o.id = u.org_id
       WHERE u.id=$1`,
      [req.userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    const user = r.rows[0];

    // Перевыпускаем токен с актуальным orgId
    const token = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const org = user.org_id ? { id: user.org_id, name: user.org_name, code: user.org_code } : null;
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id, inviteCode: user.invite_code },
      org,
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
