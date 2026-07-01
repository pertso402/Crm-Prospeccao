import axios from 'axios';
import 'dotenv/config';

const BASE = process.env.EVOLUTION_API_URL;

const KEYS = {
  '7146': process.env.EVOLUTION_KEY_7146,
  'trimly': process.env.EVOLUTION_KEY_TRIMLY,
};

function client(instancia) {
  const key = KEYS[instancia];
  if (!key) throw new Error(`Instância desconhecida: ${instancia}`);
  return axios.create({
    baseURL: `${BASE}/message`,
    headers: { apikey: key, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
}

// Registro de mensagens enviadas pelo agente (para ignorar o eco do webhook).
// A Evolution dispara messages.upsert com fromMe=true também para mensagens
// enviadas via API — sem isso, o agente pausaria o lead ao ver a própria mensagem.
const enviosRecentes = []; // { numero, texto, ts }

function registrarEnvio(numero, texto) {
  enviosRecentes.push({ numero, texto, ts: Date.now() });
  // mantém só os últimos 10 minutos
  const limite = Date.now() - 10 * 60 * 1000;
  while (enviosRecentes.length && enviosRecentes[0].ts < limite) enviosRecentes.shift();
}

export function ehEcoDoAgente(numero, texto) {
  const limite = Date.now() - 10 * 60 * 1000;
  return enviosRecentes.some(e => e.ts >= limite && e.numero === numero && e.texto === texto);
}

export async function enviarTexto(instancia, numero, texto) {
  registrarEnvio(numero, texto);
  const res = await client(instancia).post(`/sendText/${instancia}`, {
    number: numero,
    text: texto,
    delay: 1200,
  });
  return res.data;
}

export async function enviarVideo(instancia, numero, url, caption = '') {
  const res = await client(instancia).post(`/sendMedia/${instancia}`, {
    number: numero,
    mediatype: 'video',
    mimetype: 'video/mp4',
    media: url,
    caption,
    delay: 2000,
  });
  return res.data;
}

export async function registrarWebhook(instancia, webhookUrl) {
  const key = KEYS[instancia];
  const res = await axios.put(
    `${BASE}/webhook/set/${instancia}`,
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: ['MESSAGES_UPSERT'],
      }
    },
    { headers: { apikey: key } }
  );
  return res.data;
}
