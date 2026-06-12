/**
 * Fábrica de rotas CRUD genéricas.
 * Uso: require('./generico')('clientes')
 * Gera GET / POST / PUT /:id / DELETE /:id
 */
const express = require('express');
const { dbGet, dbSet } = require('../firebase');

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function today() { return new Date().toISOString().split('T')[0]; }

module.exports = function makeRouter(colName) {
  const router = express.Router();

  // GET /api/<colName>
  router.get('/', async (req, res) => {
    try {
      res.json(await dbGet(colName) || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/<colName>
  router.post('/', async (req, res) => {
    try {
      const list = await dbGet(colName) || [];
      const novo = { id: uid(), criado: today(), ...req.body };
      list.push(novo);
      await dbSet(colName, list);
      res.json(novo);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/<colName>/:id
  router.put('/:id', async (req, res) => {
    try {
      let list = await dbGet(colName) || [];
      const idx = list.findIndex(x => x.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Não encontrado.' });
      list[idx] = { ...list[idx], ...req.body };
      await dbSet(colName, list);
      res.json(list[idx]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/<colName>/:id
  router.delete('/:id', async (req, res) => {
    try {
      let list = await dbGet(colName) || [];
      list = list.filter(x => x.id !== req.params.id);
      await dbSet(colName, list);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
