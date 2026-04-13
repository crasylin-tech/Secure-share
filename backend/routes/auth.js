const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');

// Генерация уникального кода организации
function genOrgCode() {
  return 'ORG' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

// POST /api/auth/register — регистрация организации + первый администратор
router.post('/register', async (req, res) => {
  const { orgName, name, email, password } = req.body;
  if (!orgName || !name || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });

  try {
    // Проверка уникальности организации и email
    const orgExists = await db.query('SELECT id FROM organizations WHERE LOWER(name)=LOWER($1)', [orgName]);
    if (orgExists.rows.length) return res.status(409).json({ error: 'Организация с таким названием уже существует' });

    const userExists = await db.query('SELECT id FROM users WHERE email=$1', [email]);
    if (userExists.rows.length) return res.status(409).json({ error: 'Email уже занят' });

    // Создание организации
    let code = genOrgCode();
    // Гарантируем уникальность кода
    while ((await db.query('SELECT id FROM organizations WHERE code=$1', [code])).rows.length) {
      code = genOrgCode();
    }

    const orgResult = await db.query(
      'INSERT INTO organizations (name, code) VALUES ($1, $2) RETURNING *',
      [orgName, code]
    );
    const org = orgResult.rows[0];

    // Создание администратора
    const hash = await bcrypt.hash(password, 10);
    const userResult = await db.query(
      'INSERT INTO users (org_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,org_id',
      [org.id, name, email, hash, 'admin']
    );
    const user = userResult.rows[0];

    const token = jwt.sign(
      { userId: user.id, orgId: org.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: org.id },
      org:  { id: org.id, name: org.name, code: org.code },
    });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login — вход администратора по email
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Введите email и пароль' });

  try {
    const result = await db.query(
      `SELECT u.*, o.name AS org_name, o.code AS org_code
       FROM users u JOIN organizations o ON o.id=u.org_id
       WHERE u.email=$1`,
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Пользователь не найден' });

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' });

    const token = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id },
      org:  { id: user.org_id, name: user.org_name, code: user.org_code },
    });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login-employee — вход сотрудника по коду организации
router.post('/login-employee', async (req, res) => {
  const { orgCode, email, password } = req.body;
  if (!orgCode || !email || !password)
    return res.status(400).json({ error: 'Заполните все поля' });

  try {
    const orgResult = await db.query('SELECT * FROM organizations WHERE code=$1', [orgCode.toUpperCase()]);
    if (!orgResult.rows.length) return res.status(401).json({ error: 'Организация с таким кодом не найдена' });
    const org = orgResult.rows[0];

    const userResult = await db.query(
      'SELECT * FROM users WHERE email=$1 AND org_id=$2',
      [email, org.id]
    );
    if (!userResult.rows.length) return res.status(401).json({ error: 'Пользователь не найден в этой организации' });
    const user = userResult.rows[0];

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный пароль' });

    const token = jwt.sign(
      { userId: user.id, orgId: org.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: org.id },
      org:  { id: org.id, name: org.name, code: org.code },
    });
  } catch (err) {
    console.error('login-employee error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
