import OpenAI from 'openai';
import 'dotenv/config';

const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── MENSAGEM DE ABORDAGEM ──────────────────────────────────

export async function gerarMensagemAbordagem(lead) {
  const { nome_negocio, segmento, observacao_captacao, produto } = lead;

  const isCardapio = produto === 'cardapio' || !produto;

  const instrucao = isCardapio
    ? `Você é Peter, um cara que faz cardápios digitais pra food businesses e tá mandando mensagem no WhatsApp pra o dono de um estabelecimento.

CONTEXTO IMPORTANTE: você já confirmou que tá falando COM O DONO diretamente. Então:
- NÃO use "oi pessoal", "olá equipe", ou qualquer coisa que soe broadcast
- Comece diretamente no assunto, como se fosse uma conversa já em andamento
- Tom: pessoa real, animada, falando com alguém específico

OBSERVAÇÃO SOBRE ESSE LEAD (base da personalização):
${observacao_captacao || 'Nenhuma — improvise com base no segmento: ' + (segmento || 'restaurante')}

REFERÊNCIA REAL (conversa que funcionou — copie o ESTILO e a LÓGICA, não as palavras):
---
Então é que eu estava vendo o perfil Ueba e cara, a montagem dos produtos de vocês é absurda. Dá vontade de comer só de olhar, principalmente aquele Bowl Bombom rsrs

Foi por isso que te chamei. Vi que vocês usam um cardápio que prejudica esse capricho todo bem na hora que o cliente tá escolhendo o que pedir. Aquele açaí que parece incrível no feed e stories vira algo sem graça no cardápio, aí o cliente pede o básico em vez do item mais caro.

Eu faço cardápio digital sob medida pra açaiterias e docerias, esse do vídeo eu entreguei ontem pra doceria Tali. A ideia é o cliente sentir muito desejo antes de pôr a mão no bolso. Quem tá com água na boca pede mais.

Em vez de ficar te prometendo, prefiro mostrar. Eu queria montar uma prévia com a cara da marca de vocês e te enviar, de graça e sem compromisso. Você só olha e me fala o que achou. Posso tá te enviando?
---

COMO ABRIR (OBRIGATÓRIO — siga à risca):
Você JÁ cumprimentou e o dono confirmou que é ele. NÃO repita saudação. Vá DIRETO ao assunto.
A primeira frase entra no elogio sem nenhum "oi", "olá", "tudo bem?". Exemplos:
- "Então é que eu tava vendo o perfil de vocês e cara..."
- "Cara, tava aqui olhando o feed e..."
- "Tava aqui dando uma olhada nos posts de vocês e..."
PROIBIDO: "Oi [nome]", "Olá", "Oi pessoal", "Oi tudo bem", qualquer saudação na abertura.

ESTRUTURA (4 parágrafos curtos):
1. Abertura + elogio concreto: siga o padrão acima. Cite produto específico da observação. UMA frase de elogio, curta.
2. O problema tangível: "o cliente vê [isso no feed], abre o cardápio e acaba pedindo o básico em vez do [item mais caro]". Concreto, sem metáforas.
3. Solução + prova: faço cardápio digital sob medida, entreguei pra doceria Tali. "A ideia é o cliente sentir muito desejo antes de pôr a mão no bolso. Quem tá com água na boca pede mais."
4. CTA: pedir permissão pra montar prévia, de graça, sem compromisso.

PALAVRAS E EXPRESSÕES PROIBIDAS (disparam alarme de IA):
- "gritante", "fascinado", "cuidado na apresentação", "justamente", "personalizado", "resolver situações", "transformar a experiência"
- Qualquer frase com estrutura de relatório ou apresentação comercial
- Abertura com nome do estabelecimento: NUNCA comece com "Oi [nome]!" ou "Olá [nome]!"
- Em-dash (—), bullet points, listas, emojis em excesso

TOM OBRIGATÓRIO:
- WhatsApp real. Parágrafos curtinhos. Pode ter "rsrs", "cara", "olha", sem exagero.
- NUNCA termine frases com elogios vagos como "muito legal mesmo!", "super bacana!", "incrível mesmo!"
- NUNCA use expressão "o mesmo desejo que X passa" — é detectável como IA.
- A mensagem pode ter uma frase curta, incompleta, coloquial. Não precisa ser gramaticalmente perfeita.
- Se você leu em voz alta e soa como apresentação de vendas ou texto de IA, reescreva do zero.
- Deve parecer que uma pessoa animada digitou agora no celular, não que foi gerado e colado.`
    : `Você é Peter, especialista em agentes de atendimento WhatsApp para marmitarias.
Escreva uma abordagem para "${nome_negocio}" (${segmento || 'marmitaria'}).

OBSERVAÇÃO SOBRE ESSE LEAD:
${observacao_captacao || 'Nenhuma observação específica.'}

ESTRUTURA (4 parágrafos):
1. Elogio específico baseado na observação
2. Problema tangível: na hora do pico o atendente não consegue responder todos, cliente espera, desiste e pede em outro lugar — cite comportamento concreto do consumidor
3. Solução: agente de atendimento que responde 24h, monta o pedido e envia pro painel automaticamente
4. CTA: pedir permissão para mostrar como funciona, de graça e sem compromisso

REGRAS: WhatsApp real, tom casual brasileiro, sem linguagem corporativa, máximo 4 parágrafos`;

  // Força o início da mensagem — o modelo só precisa completar a partir daqui
  const aberturas = [
    'Então é que eu tava vendo o perfil de vocês e cara,',
    'Cara, tava aqui olhando o feed de vocês e',
    'Tava aqui dando uma olhada nos posts de vocês e,',
    'Opa, estava aqui no perfil de vocês e',
  ];
  const aberturaForçada = aberturas[Math.floor(Math.random() * aberturas.length)];

  const res = await ai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: instrucao },
      { role: 'assistant', content: aberturaForçada },
    ],
    temperature: 0.85,
    max_tokens: 380,
  });

  return aberturaForçada + ' ' + res.choices[0].message.content.trim();
}

// ── DETECTAR INTENÇÃO DA RESPOSTA ─────────────────────────

export async function classificarResposta(mensagem, contexto = {}) {
  const {
    pitchEnviado = false,
    aguardandoDono = false,
    ultimaPerguntas = null,
    historico = [], // últimas mensagens [{role, texto}]
  } = contexto;

  // Últimas 4 trocas como contexto
  const historicoFormatado = historico.slice(-4).map(m =>
    `${m.role === 'ia' ? 'Agente' : m.role === 'lead' ? 'Lead' : 'Sistema'}: ${m.texto}`
  ).filter(Boolean).join('\n');

  const contextoUltimaMsg = ultimaPerguntas === 'dono'
    ? 'IMPORTANTE: a última mensagem enviada pelo agente foi "Eu falo com o dono(a)?". Respostas como "sim", "sou eu", "é", "comigo", "pode falar", "eu mesmo" = DECISOR. Respostas como "não", "sou atendente", "não está" = GATEKEEPER.'
    : ultimaPerguntas === 'horario_dono'
    ? 'IMPORTANTE: a última mensagem foi perguntando em que horário o dono estará. Qualquer resposta com horário, dia ou disponibilidade = HORARIO_DONO.'
    : ultimaPerguntas === 'pitch'
    ? 'IMPORTANTE: o pitch de venda foi enviado. A pessoa já viu a proposta. Interesse = INTERESSE.'
    : '';

  const res = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Classifique uma mensagem recebida no WhatsApp de um restaurante/estabelecimento.
Contexto da conversa:
- Pitch de venda já foi enviado ao decisor: ${pitchEnviado ? 'SIM' : 'NÃO'}
- Já identificamos que é atendente e perguntamos quando o dono estará: ${aguardandoDono ? 'SIM' : 'NÃO'}
${contextoUltimaMsg}

Responda com APENAS UMA palavra:

BOT → automatizado: múltiplos emojis (🤖✨😊🤩), lista de serviços, links (anota.ai, goomer), "Estou aqui para ajudar", menu numerado. Bots enviam 2+ mensagens seguidas ou lista formatada.

GATEKEEPER → humano que NÃO é o dono, e está se identificando como tal: "como posso ajudar", "pois não", "nao, atendente", "sou atendente", "nao é comigo", "não sou eu".

PERGUNTA_ATENDENTE → atendente/funcionário fazendo QUALQUER PERGUNTA sobre o assunto, motivo ou propósito do contato: "sobre o que seria?", "qual assunto?", "quem gostaria?", "com quem eu falo?", "pode falar o que é?", "do que se trata?".

OBJECAO → qualquer objeção ou argumento contrário à proposta: "já temos cardápio", "já uso outra plataforma", "não tenho interesse nisso", "a gente já tem sistema", "não preciso", "meu cardápio já é bom", "já temos isso", "não vale a pena". Inclui objeções indiretas como "ja temos" referindo-se a algo relacionado ao produto.
${aguardandoDono ? 'ATENÇÃO: se a mensagem informa horário ou disponibilidade do dono (ex: "ele chega às 18h", "não, está ausente", "amanhã"), classifique como HORARIO_DONO.' : ''}

RELAY → atendente se oferece para repassar a mensagem ao dono: "pode falar que eu repasso", "me fala que eu passo pra ele", "deixa eu passar pra ele", "pode me mandar que eu mostro pra ele", "vou passar pra ele", "eu repasso", "eu falo com ela pra você", "pode me dizer que eu mostro". Diferente de GATEKEEPER — aqui o atendente está oferecendo ativamente ser o intermediário.

HORARIO_DONO → atendente informa quando o dono estará disponível: "ele chega às X", "só amanhã", "está ausente", "volta às X".

DECISOR → confirmou ser o dono/responsável: "sou eu mesmo", "sou o dono", "sou eu", "é comigo", "sim sou eu".

${pitchEnviado
  ? `INTERESSE → após receber o pitch, demonstrou interesse: quer ver mais, topou receber a prévia, deu número, "pode enviar", "me manda", "quero ver", "quanto custa", "como funciona".
PERGUNTA → fez pergunta sobre o produto após o pitch.
SEM_INTERESSE → recusou após o pitch: "não tenho interesse", "não preciso", "já tenho".`
  : `INTERESSE → NÃO USE. O pitch ainda não foi enviado, nenhuma resposta pode ser interesse real ainda.
PERGUNTA → NÃO USE antes do pitch.
SEM_INTERESSE → recusa explícita: "não quero", "não me ligue mais", "remove meu número".`}

ATENDEU → alguém simplesmente atendeu sem se identificar: "oi", "olá", "boa tarde", "boa noite", "bom dia", "alô", "sim", "oi tudo bem", "pois não". Qualquer saudação curta ou confirmação vaga de que alguém pegou o telefone. ATENÇÃO: esse é o caso mais comum — quando em dúvida entre ATENDEU e NEUTRO, classifique como ATENDEU.

NEUTRO → resposta que claramente não é saudação nem confirmação, mas também não se encaixa em nenhuma outra categoria.

${historicoFormatado ? `\nHistórico recente:\n${historicoFormatado}\n` : ''}
Mensagem atual: "${mensagem}"`
    }],
    temperature: 0,
    max_tokens: 20,
  });

  return res.choices[0].message.content.trim().toUpperCase();
}

// ── MENSAGEM DE FOLLOW-UP ─────────────────────────────────

export async function gerarFollowUp(lead, tentativa) {
  const frases = [
    `Oi, tudo bem? Passou um tempinho e queria saber se você teve chance de ver o que te mandei. Posso enviar aquela prévia do cardápio pra vocês?`,
    `Oi! Sei que a rotina é corrida no restaurante. Só passando pra ver se consigo mostrar como o cardápio de vocês ficaria. É rápido, de graça e sem compromisso nenhum.`,
    `Última tentativa de contato! Tenho uma prévia do cardápio digital montada com a identidade de vocês aqui. Se quiser dar uma olhada, é só me falar. Fica à vontade!`,
  ];
  return frases[Math.min(tentativa - 1, frases.length - 1)];
}
