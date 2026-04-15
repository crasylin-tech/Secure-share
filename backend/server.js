require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app = express();

app.use(cors({ origin: true, credentials: true, methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', cors());

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/org',         require('./routes/org'));
app.use('/api/chats',       require('./routes/chats'));
app.use('/api/org-files',   require('./routes/orgFiles'));
app.use('/api/invitations', require('./routes/invitations'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅  SecureShare API запущен на порту ${PORT}`);
  console.log(`    Окружение: ${process.env.NODE_ENV || 'development'}`);
});
