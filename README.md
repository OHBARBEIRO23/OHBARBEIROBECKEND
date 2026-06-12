# Oh Barbeiro — Deploy separado (Backend + Frontend)

## Estrutura
```
backend/   → API Express + JWT (sobe no servidor)
adm.html   → painel admin (sobe no GitHub Pages)
```

---

## 1. Configurar o Backend

### 1.1 Firebase Admin SDK
1. Acesse: https://console.firebase.google.com
2. Projeto `ohbarbeiro-4de93` → Configurações → **Contas de serviço**
3. Clique em **Gerar nova chave privada** → baixa um `.json`
4. Você vai usar os campos `client_email` e `private_key` desse JSON no `.env`

### 1.2 Criar o arquivo `.env`
Dentro da pasta `backend/`, copie o `.env.example`:
```bash
cp .env.example .env
```
Preencha todos os campos:
```env
JWT_SECRET=uma_string_longa_e_aleatoria_qualquer
JWT_EXPIRES_IN=8h
ADMIN_EMAIL=seu@email.com
ADMIN_PASSWORD=suasenhaforte
FIREBASE_PROJECT_ID=ohbarbeiro-4de93
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@ohbarbeiro-4de93.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nXXXXX\n-----END PRIVATE KEY-----\n"
PORT=3000
FRONTEND_URL=https://SEU_USUARIO.github.io
```

> **NUNCA** suba o `.env` para o GitHub. Ele já está no `.gitignore`.

### 1.3 Instalar dependências
```bash
cd backend
npm install
```

### 1.4 Testar local
```bash
npm run dev
# Acesse: http://localhost:3000/health
# Deve retornar: {"ok":true,"ts":...}
```

---

## 2. Hospedar o Backend

### Opção A — Railway (recomendado, grátis pra começar)
1. Crie conta em https://railway.app
2. Novo projeto → **Deploy from GitHub repo**
3. Selecione o repositório com a pasta `backend/`
4. Em **Variables**, adicione todas as variáveis do `.env`
5. Railway vai dar uma URL tipo: `https://ohbarbeiro-api.railway.app`

### Opção B — Render (também grátis)
1. Crie conta em https://render.com
2. New → **Web Service** → conecte o repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Adicione as variáveis de ambiente no painel

### Opção C — VPS próprio (DigitalOcean, Hostinger, etc.)
```bash
# No servidor:
git clone seu-repo
cd backend
npm install
# Use PM2 para manter rodando:
npm install -g pm2
pm2 start server.js --name ohbarbeiro-api
pm2 startup
pm2 save
```

---

## 3. Configurar o Frontend (adm.html)

Após hospedar o backend, edite o `adm.html`:

Procure essa linha (no início do `<script>`):
```js
const API_URL = 'https://SUA_API.railway.app'; // ← TROQUE AQUI
```

Troque pela URL real do seu servidor:
```js
const API_URL = 'https://ohbarbeiro-api.railway.app';
```

---

## 4. Subir o Frontend no GitHub Pages

1. No seu repo GitHub, coloque o `adm.html` na raiz ou pasta `/docs`
2. Settings → Pages → Source: **Deploy from branch** → `main` → `/root`
3. Acesse: `https://SEU_USUARIO.github.io/ohbarbeiro/adm.html`

---

## 5. Atualizar CORS no Backend

No `.env` do backend, atualize a URL do frontend:
```env
FRONTEND_URL=https://SEU_USUARIO.github.io
```
Redeploy o backend após essa mudança.

---

## Rotas da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/login | Login (retorna JWT) |
| GET | /api/agendamentos | Listar agendamentos |
| POST | /api/agendamentos | Criar agendamento |
| PUT | /api/agendamentos/:id | Editar agendamento |
| DELETE | /api/agendamentos/:id | Excluir agendamento |
| GET/POST/PUT/DELETE | /api/clientes | CRUD clientes |
| GET/POST/PUT/DELETE | /api/servicos | CRUD serviços |
| GET/POST/PUT/DELETE | /api/produtos | CRUD produtos |
| GET/POST/PUT/DELETE | /api/barbeiros | CRUD barbeiros |
| GET/POST/PUT/DELETE | /api/receitas | CRUD receitas |
| GET/POST/PUT/DELETE | /api/despesas | CRUD despesas |
| GET | /api/config/:chave | Ler configuração |
| PUT | /api/config/:chave | Salvar configuração |
| GET | /health | Checar se API está viva |

Todas as rotas (exceto `/api/login` e `/health`) exigem header:
```
Authorization: Bearer SEU_TOKEN_JWT
```
