const router = require('express').Router();
const { dbGet, dbSet } = require('../firebase');

// Apenas agendamentos e clientes podem ser escritos publicamente
const PERMITIDAS = ['agendamentos', 'clientes'];

// POST /api/public/:chave
// Rota sem autenticação — usada pelo site para salvar agendamentos
router.post('/:chave', async (req, res) => {
  const { chave } = req.params;

  if (!PERMITIDAS.includes(chave)) {
    return res.status(403).json({ error: 'Operação não permitida.' });
  }

  if (!Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Body deve ser um array.' });
  }

  try {
    await dbSet(chave, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
