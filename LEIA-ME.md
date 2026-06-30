# Sistema de Prospecção ARTe

## Estrutura de arquivos

```
Prospeccao/
├── index.js              ← entrada principal (servidor webhook + scheduler)
├── package.json
├── .env                  ← suas chaves (NÃO commitar)
├── migration.sql         ← rodar UMA VEZ no Supabase SQL Editor
├── painel.html           ← abrir no browser para monitorar
└── src/
    ├── agente.js         ← lógica da conversa
    ├── db.js             ← operações no Supabase
    ├── evolution.js      ← envio de mensagens WhatsApp
    ├── openai.js         ← geração de mensagens + classificação
    └── scheduler.js      ← agendamento de abordagens e follow-ups
```

## Como rodar

### 1. Instalar dependências
```
npm install
```

### 2. Configurar o .env
- Coloque sua chave OpenAI em `OPENAI_API_KEY`
- Resto já está preenchido

### 3. Rodar a migration no Supabase
- Abra o SQL Editor em https://supabase.com/dashboard/project/nnnrnaxvghgbtqjlxjnk/sql
- Cole o conteúdo de `migration.sql` e execute

### 4. Configurar webhook na Evolution API
Após subir o servidor, configure o webhook em cada instância:
- URL: `http://SEU_IP:3000/webhook`
- Evento: `MESSAGES_UPSERT`

Ou chame via curl:
```bash
curl -X POST http://localhost:3000/webhook-setup
```

### 5. Subir o servidor
```
npm start
```

### 6. Abrir o painel
Abra `painel.html` no browser. Atualiza em tempo real.

---

## Adicionar leads

Na tabela `leads` do Supabase, adicione um lead com:
- `nome_negocio`: nome do estabelecimento
- `whatsapp`: número no formato `5544999990000`
- `produto`: `cardapio` ou `agente_atendimento`
- `instancia_whatsapp`: `trimly` ou `7146`
- `observacao_captacao`: o que você observou (Instagram, cardápio atual, etc.)
- `horario_abertura` / `horario_fechamento`: ex: `11:00:00` / `22:00:00`
- `stage`: deixe como `novo`

O agente vai pegar automaticamente dentro da janela de horário.

---

## Pipeline cardápio (pipeline 1)

```
novo → abordagem_enviada → [sem resposta] → follow_up_frio → perdido
                         → [interesse]    → interessado (Peter assume)
                         → [gatekeeper]   → aguardando_decisor
```

## Pipeline marmitaria (pipeline 2)
Mesma lógica — ativar quando tiver o script e vídeo.

---

## Warmup (anti-ban)

Semana 1: máximo 30 leads/dia
Semana 2: máximo 40 leads/dia
A partir da semana 3: máximo 50 leads/dia

Ajuste `LIMITE_DIARIO` em `src/scheduler.js`.
