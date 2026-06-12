const router = require('express').Router();
const { dbGet, dbSet } = require('../firebase');

// GET /api/agendamentos
router.get('/', async (req, res) => {
  try {
    const data = await dbGet('agendamentos') || [];
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/agendamentos
router.post('/', async (req, res) => {
  try {
    const list = await dbGet('agendamentos') || [];
    const novo = { id: uid(), criado: today(), ...req.body };
    list.push(novo);
    await dbSet('agendamentos', list);
    res.json(novo);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/agendamentos/:id
router.put('/:id', async (req, res) => {
  try {
    let list = await dbGet('agendamentos') || [];
    const idx = list.findIndex(x => x.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Não encontrado.' });
    list[idx] = { ...list[idx], ...req.body };
    await dbSet('agendamentos', list);
    res.json(list[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/agendamentos/:id
router.delete('/:id', async (req, res) => {
  try {
    let list = await dbGet('agendamentos') || [];
    list = list.filter(x => x.id !== req.params.id);
    await dbSet('agendamentos', list);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function today() { return new Date().toISOString().split('T')[0]; }

module.exports = router;
