const router  = require('express').Router();
const jwt     = require('jsonwebtoken');

// POST /api/login
// Body: { email, password }
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (
    email    !== process.env.ADMIN_EMAIL ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  const token = jwt.sign(
    { email, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({ token, email });
});

module.exports = router;

// POST /api/trocar-senha
// Body: { senhaAtual, senhaNova }
// Troca a senha do admin no .env (em produção, use variável de ambiente no painel do servidor)
router.post('/trocar-senha', require('../middleware/auth'), (req, res) => {
  const { senhaAtual, senhaNova } = req.body;

  if (senhaAtual !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }
  if (!senhaNova || senhaNova.length < 6) {
    return res.status(400).json({ error: 'Nova senha precisa ter ao menos 6 caracteres.' });
  }

  // Em produção: atualize a variável ADMIN_PASSWORD no painel do Railway/Render
  // Aqui retornamos instrução clara
  res.json({
    ok: true,
    aviso: 'Atualize a variável ADMIN_PASSWORD no painel do seu servidor (Railway/Render) para: ' + senhaNova
  });
});
