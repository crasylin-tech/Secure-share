const jwt = require('jsonwebtoken');

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Токен авторизации не предоставлен' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId  = payload.userId;
    req.orgId   = payload.orgId;
    req.role    = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный или просроченный токен' });
  }
};
