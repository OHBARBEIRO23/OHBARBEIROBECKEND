require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const auth       = require('./middleware/auth');

const app = express();

// Necessário no Render (e em qualquer host atrás de proxy reverso):
// sem isso, o express-rate-limit não consegue ler o IP real do
// cabeçalho X-Forwarded-For e derruba a requisição com erro.
app.set('trust proxy', 1);

// ── Webhook do bot de WhatsApp ───────────────────────────────────
// Registrado ANTES do CORS de propósito: quem chama essa rota é o
// servidor da Z-API (não um navegador), então não faz sentido — e
// quebraria o bot — aplicar a checagem de origem usada pro frontend.
app.post('/api/whatsapp/webhook', express.json({ limit: '2mb' }), require('./routes/whatsappBot').handleWebhook);

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

// ── Cobrança manual: avisar UM assinante específico via WhatsApp ─
app.post('/api/cobranca/enviar/:assinaturaId', auth, async (req, res) => {
  try {
    const { enviarCobrancaManual } = require('./routes/cobranca');
    const resultado = await enviarCobrancaManual(req.params.assinaturaId);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Bot de agendamento via WhatsApp ──────────────────────────────
// (webhook já registrado no topo do arquivo, antes do CORS)
const whatsappBot = require('./routes/whatsappBot');

// Pausar/retomar o bot para um cliente — chamado pelo botão no adm.html
app.post('/api/whatsapp/pausar', auth, async (req, res) => {
  try {
    const { telefone, motivo } = req.body;
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório.' });
    await whatsappBot.pausarBot(telefone, motivo || 'painel_admin');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/whatsapp/retomar', auth, async (req, res) => {
  try {
    const { telefone } = req.body;
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório.' });
    await whatsappBot.retomarBot(telefone);
    res.json({ ok: true });
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
