const router = require('express').Router();
const { dbGet, dbSet } = require('../firebase');

const KEYS_PERMITIDAS = [
  'config', 'hero', 'localizacao', 'horarios',
  'clube', 'rodape', 'theme', 'metas', 'planos', 'galeria',
  'receitas_mes_ant'
];

// Chaves que armazenam arrays (não objetos)
const KEYS_ARRAY = ['planos', 'galeria'];

// GET /api/config/:chave
router.get('/:chave', async (req, res) => {
  const { chave } = req.params;
  if (!KEYS_PERMITIDAS.includes(chave))
    return res.status(400).json({ error: 'Chave não permitida.' });
  try {
    const val = await dbGet(chave);
    const empty = KEYS_ARRAY.includes(chave) ? [] : {};
    res.json(val ?? empty);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/config/:chave
router.put('/:chave', async (req, res) => {
  const { chave } = req.params;
  if (!KEYS_PERMITIDAS.includes(chave))
    return res.status(400).json({ error: 'Chave não permitida.' });
  try {
    await dbSet(chave, req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
