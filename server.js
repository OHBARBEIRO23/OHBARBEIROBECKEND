  require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const auth       = require('./middleware/auth');

const app = express();

// ── CORS ──────────────────────────────────────────────────────
// Permite o frontend do GitHub Pages + localhost pra desenvolvimento
const origens = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3001',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Permite requisições sem origin (Postman, curl) e origens autorizadas
    if (!origin || origens.includes(origin)) return cb(null, true);
    cb(new Error('CORS bloqueado: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '5mb' })); // limite pra uploads base64

// ── Rate limit geral ──────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  message: { error: 'Muitas requisições. Aguarde.' },
}));

// ── Rotas públicas ────────────────────────────────────────────
// Login agora é feito pelo Firebase Authentication direto no frontend.
app.use('/api/public', require('./routes/public')); // agendamentos do site (sem login)

// ── Rotas protegidas (todas exigem token Firebase válido) ───────
app.use('/api/agendamentos', auth, require('./routes/agendamentos'));
app.use('/api/clientes',     auth, require('./routes/generico')('clientes'));
app.use('/api/servicos',     auth, require('./routes/generico')('servicos'));
app.use('/api/produtos',     auth, require('./routes/generico')('produtos'));
app.use('/api/barbeiros',    auth, require('./routes/generico')('barbeiros'));
app.use('/api/receitas',     auth, require('./routes/generico')('receitas'));
app.use('/api/despesas',     auth, require('./routes/generico')('despesas'));
app.use('/api/config',       auth, require('./routes/config'));

app.use('/api/bulk',         auth, require('./routes/bulk'));
// Troca de senha agora é feita pelo Firebase (Console ou e-mail de reset).

// ── Rota de saúde (pra checar se o servidor tá vivo) ──────────
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Erro global ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erro interno.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
