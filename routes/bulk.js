const router = require('express').Router();
const { dbSet } = require('../firebase');

const LISTAS_PERMITIDAS = ['agendamentos','clientes','servicos','produtos','barbeiros','receitas','despesas','assinaturas'];

// PUT /api/bulk/:chave  — substitui a lista inteira
router.put('/:chave', async (req, res) => {
  const { chave } = req.params;
  if (!LISTAS_PERMITIDAS.includes(chave))
    return res.status(400).json({ error: 'Chave não permitida.' });
  if (!Array.isArray(req.body))
    return res.status(400).json({ error: 'Body deve ser um array.' });
  try {
    await dbSet(chave, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
