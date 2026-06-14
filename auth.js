const admin = require('firebase-admin');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente.' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.admin = decoded;
    next();
  } catch (e) {
    console.error('Erro verifyIdToken:', e.message); // LOG TEMPORÁRIO
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
};
