import axios from 'axios';
import fs from 'fs';
import { google } from 'googleapis';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Storage } from '@google-cloud/storage';

// — Configurações gerais —
const METADATA_PATH           = './metadata.json';
const JSON_CACHE_COMPRAS_PATH = './compras_cache.json';
const JSON_CACHE_VENDAS_PATH  = './vendas_cache.json';
const ID_DEPOSITO             = '14088231094';
const CATEGORY_ID_VALID       = 12269489770;
const SECRET_NAME             = 'projects/analise-de-cobertura/secrets/Credenciais-API-Bling/versions/latest';

// Cloud Storage para metadata
const BUCKET_NAME = 'analise-cobertura-metadata';
const storage     = new Storage();

// Secret Manager
const client = new SecretManagerServiceClient();

// — Contador diário (reset à meia-noite) —
let dailyCount = 0;
let dailyDate  = new Date().toISOString().slice(0,10);
const DAILY_LIMIT = 120_000;
function checkDailyLimit() {
  const today = new Date().toISOString().slice(0,10);
  if (today !== dailyDate) {
    dailyDate  = today;
    dailyCount = 0;
  }
  if (++dailyCount > DAILY_LIMIT) {
    throw new Error(`Limite diário de ${DAILY_LIMIT} requisições atingido.`);
  }
}

// — Safe retry —
async function safeRequest(fn, desc, retries = 2, backoff = 2000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`⚠️ ${desc} falhou (${i+1}/${retries+1}): ${err.message}`);
      if (i < retries) {
        await new Promise(r => setTimeout(r, backoff));
      } else {
        console.error(`❌ ${desc} falhou de vez.`);
        return null;
      }
    }
  }
}

// — Carrega credenciais e URL base corrigida —
async function carregarCredenciais() {
  const [ver] = await client.accessSecretVersion({ name: SECRET_NAME });
  const c = JSON.parse(ver.payload.data.toString());
  return {
    ACCESS_TOKEN: c.access_token.trim(),
    BLING_API_URL: 'https://api.bling.com.br/Api/v3'
  };
}

// — RateLimiter: 3 req/s → intervalo ≈ 334ms —
class RateLimiter {
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
    this.last       = 0;
  }

  async request(fn) {
    checkDailyLimit();
    const now  = Date.now();
    const next = this.last + this.intervalMs;
    if (now < next) {
      await new Promise(r => setTimeout(r, next - now));
    }
    const res  = await fn();
    this.last  = Date.now();
    return res;
  }
}
const rateLimiter = new RateLimiter(Math.ceil(1000 / 3));

// — metadata.json (lastRun) —
function loadMetadata() {
  if (!fs.existsSync(METADATA_PATH)) {
    const m = { lastRun: '2023-01-01' };
    fs.writeFileSync(METADATA_PATH, JSON.stringify(m, null, 2));
    return m;
  }
  try {
    return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
  } catch {
    const m = { lastRun: '2023-01-01' };
    fs.writeFileSync(METADATA_PATH, JSON.stringify(m, null, 2));
    return m;
  }
}
function saveMetadata(m) {
  fs.writeFileSync(METADATA_PATH, JSON.stringify(m, null, 2));
}

// — cache JSON —
function loadCache(path) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, '{}');
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}
function saveCache(obj, path) {
  fs.writeFileSync(path, JSON.stringify(obj, null, 2));
}

// — Google Sheets helpers —
async function authenticateGoogle() {
  const auth = new google.auth.GoogleAuth({
    keyFile: './analise-de-cobertura-92fcbc2f5306.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return await auth.getClient();
}

async function getSheets(auth, id, range) {
  const sheets = google.sheets({ version: 'v4', auth });
  const resp   = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
  return resp.data.values || [];
}

async function updateSheets(auth, id, range, values) {
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range,
    valueInputOption: 'RAW',
    resource: { values }
  });
}

// — Coleta de compras —
async function coletarCompras(dataInicial, cacheCompras) {
  const { ACCESS_TOKEN, BLING_API_URL } = await carregarCredenciais();
  const c = cacheCompras || loadCache(JSON_CACHE_COMPRAS_PATH);
  let page = 1;
  while (true) {
    const dataFinal = new Date().toISOString().slice(0, 10);
    const url = `${BLING_API_URL}/pedidos/compras` +
                `?pagina=${page}&limite=100&valorSituacao=1` +
                `&dataInicial=${dataInicial}&dataFinal=${dataFinal}`;
    console.log(`📦 Compras p.${page}: ${url}`);

    const resp = await safeRequest(
      () => rateLimiter.request(() =>
        axios.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } })
      ),
      `listar compras p.${page}`
    );
    const arr = resp?.data?.data;
    if (!arr?.length) break;

    for (const p of arr) {
      const id = Number(p.id);
      if (c[id]) continue;
      console.log(`   🔍 detalhe compra ${id}`);

      const detResp = await safeRequest(
        () => rateLimiter.request(() =>
          axios.get(`${BLING_API_URL}/pedidos/compras/${id}`, {
            headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
          })
        ),
        `detalhar compra ${id}`
      );

      const detalhe = detResp?.data?.data;
      if (detalhe && detalhe.categoria?.id === CATEGORY_ID_VALID) {
        c[id] = detalhe;
        console.log(`   ➕ adicionada compra ${id}`);
      }
    }
    page++;
  }
  saveCache(c, JSON_CACHE_COMPRAS_PATH);
  return c;
}

// — Coleta de vendas —
async function coletarVendas(dataInicial, cacheVendas) {
  const { ACCESS_TOKEN, BLING_API_URL } = await carregarCredenciais();
  const v = cacheVendas || loadCache(JSON_CACHE_VENDAS_PATH);
  let page = 1;
  while (true) {
    const dataFinal = new Date().toISOString().slice(0, 10);
    const url = `${BLING_API_URL}/pedidos/vendas` +
                `?pagina=${page}&limite=100&idsSituacoes[]=9` +
                `&dataInicial=${dataInicial}&dataFinal=${dataFinal}`;
    console.log(`🛒 Vendas p.${page}: ${url}`);

    const resp = await safeRequest(
      () => rateLimiter.request(() =>
        axios.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } })
      ),
      `listar vendas p.${page}`
    );
    const arr = resp?.data?.data;
    if (!arr?.length) break;

    for (const p of arr) {
      const id = Number(p.id);
      if (v[id]) continue;
      console.log(`   🔍 detalhe venda ${id}`);

      const detResp = await safeRequest(
        () => rateLimiter.request(() =>
          axios.get(`${BLING_API_URL}/pedidos/vendas/${id}`, {
            headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
          })
        ),
        `detalhar venda ${id}`
      );

      const detalhe = detResp?.data?.data;
      if (detalhe) {
        v[id] = detalhe;
        console.log(`   ➕ adicionada venda ${id}`);
      }
    }
    page++;
  }
  saveCache(v, JSON_CACHE_VENDAS_PATH);
  return v;
}

// — Consulta saldo de estoque —
async function consulterSaldo(sku) {
  const { ACCESS_TOKEN, BLING_API_URL } = await carregarCredenciais();
  const url = `${BLING_API_URL}/estoques/saldos/${ID_DEPOSITO}` +
              `?codigos[]=${encodeURIComponent(sku)}`;
  console.log(`💰 Saldo SKU ${sku}`);
  const resp = await safeRequest(
    () => rateLimiter.request(() =>
      axios.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } })
    ),
    `consultar saldo ${sku}`
  );
  return resp?.data?.data?.[0]?.saldoFisicoTotal || 0;
}

// — Função principal —
async function main() {
  // Download metadata.json do bucket
  try {
    await storage.bucket(BUCKET_NAME)
                 .file('metadata.json')
                 .download({ destination: METADATA_PATH });
    console.log('↘️ metadata.json baixado do bucket');
  } catch {
    console.log('ℹ️ metadata.json não existe no bucket, criando novo');
  }

  const meta    = loadMetadata();
  const lastRun = meta.lastRun;
  console.log(`🔄 Iniciando coleta desde ${lastRun}`);

  // Carregar planilha
  const auth      = await authenticateGoogle();
  const SHEET_ID  = '13yML4Kkt3rH7SDrIii9YD5cNQRPGrFPB_HBe3IuNPPA';
  const RANGE     = 'Dados Bling!A1:G';
  const rawData   = await getSheets(auth, SHEET_ID, RANGE);
  const skus      = rawData.slice(1).map(r => r[0]);

  // Executar coletas
  const compras = await coletarCompras(lastRun, loadCache(JSON_CACHE_COMPRAS_PATH));
  const vendas  = await coletarVendas (lastRun, loadCache(JSON_CACHE_VENDAS_PATH));

  // Processar cada SKU e escrever em A–G
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    const row = rawData[i + 1];

    // Coluna B (índice 1): última compra
    const ultComp = Object.values(compras)
      .filter(c => Array.isArray(c.itens) && c.itens.some(it => it.produto.codigo === sku))
      .sort((a, b) => new Date(b.data) - new Date(a.data))[0];
    if (ultComp) {
      row[1] = ultComp.data.split('T')[0];
      row[3] = ultComp.parcelas?.slice(-1)[0]?.dataVencimento || row[3];
      const qtd = ultComp.itens.find(it => it.produto.codigo === sku)?.quantidade;
      if (qtd !== undefined) row[4] = qtd;
    }

    // Coluna C (índice 2): última venda após última entrada
    const since = row[1] || lastRun;
    const vendasFiltradas = Object.values(vendas)
      .filter(v => Array.isArray(v.itens)
                && v.itens.some(it => it.codigo === sku)
                && new Date(v.dataSaida || v.data) >= new Date(since)
      );
    const ultVenda = vendasFiltradas
      .sort((a, b) => new Date(b.dataSaida || b.data) - new Date(a.dataSaida || a.data))[0];
    if (ultVenda) {
      row[2] = ultVenda.dataSaida?.split('T')[0];
    }

    // Coluna F (índice 5): saldo em estoque
    row[5] = await consulterSaldo(sku);

    // Coluna G (índice 6): quantidade vendida desde lastRun
    const qtdVendida = vendasFiltradas.reduce((sum, v) => sum + (v.itens.find(it => it.codigo === sku)?.quantidade || 0), 0);
    row[6] = qtdVendida;
  }

  // Atualizar planilha
  await updateSheets(auth, SHEET_ID, RANGE, rawData);

  // Salvar e enviar metadata atualizado
  meta.lastRun = new Date().toISOString().slice(0, 10);
  saveMetadata(meta);
  await storage.bucket(BUCKET_NAME)
               .upload(METADATA_PATH, { destination: 'metadata.json' });
  console.log('↗️ metadata.json enviado para o bucket');

  console.log('✅ Coleta finalizada. Próximo lastRun =', meta.lastRun);
}

// Executar main
main().catch(err => {
  console.error('❌ FATAL:', err.message);
  process.exit(1);
});

