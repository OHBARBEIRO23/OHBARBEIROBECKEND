require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const auth       = require('./middleware/auth');

const app = express();

// ── CORS ──────────────────────────────────────────────────────
const origens = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3001',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origens.includes(origin)) return cb(null, true);
    cb(new Error('CORS bloqueado: ' + origin));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '5mb' }));

// ── Rate limit geral ──────────────────────────────────────────
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000,
  message: { error: 'Muitas requisições. Aguarde.' },
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Rotas públicas ────────────────────────────────────────────
app.use('/api/public', require('./routes/public'));

// ── Rotas protegidas ─────────────────────────────────────────
app.use('/api/agendamentos', auth, require('./routes/agendamentos'));
app.use('/api/clientes',     auth, require('./routes/generico')('clientes'));
app.use('/api/servicos',     auth, require('./routes/generico')('servicos'));
app.use('/api/produtos',     auth, require('./routes/generico')('produtos'));
app.use('/api/barbeiros',    auth, require('./routes/generico')('barbeiros'));
app.use('/api/receitas',     auth, require('./routes/generico')('receitas'));
app.use('/api/despesas',     auth, require('./routes/generico')('despesas'));
app.use('/api/assinaturas',  auth, require('./routes/generico')('assinaturas'));
app.use('/api/config',       auth, require('./routes/config'));
app.use('/api/bulk',         auth, require('./routes/bulk'));

// ── Rota de teste manual da cobrança (REMOVER depois de testar) ─
app.get('/api/test-cobranca', auth, async (req, res) => {
  try {
    const { checkAndSendCobrancas } = require('./routes/cobranca');
    await checkAndSendCobrancas();
    res.json({ ok: true, msg: 'Cobrança disparada — veja os logs do Render.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rota de saúde ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Erro global ───────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Erro interno.' });
});

// ── Cobrança automática via WhatsApp (todo dia às 09h) ────────
const cron = require('node-cron');
const { checkAndSendCobrancas } = require('./routes/cobranca');

cron.schedule('0 9 * * *', () => {
  console.log('[cron] Iniciando cobrança automática...');
  checkAndSendCobrancas().catch(console.error);
}, { timezone: 'America/Sao_Paulo' });

console.log('[cron] Agendamento de cobrança ativado — dispara todo dia às 09h');

// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
