
# Análise de Cobertura

## Descrição
Este projeto automatiza a coleta de dados de pedidos de compra e venda da API do Bling, processa as informações e atualiza uma planilha Google Sheets. Destina-se a facilitar o acompanhamento de estoque, vendas e compras de um e-commerce.

## Estrutura de Arquivos

```
├── Dockerfile
├── index.mjs
├── coleta.mjs
├── metadata.json
├── compras_cache.json
├── vendas_cache.json
├── package.json
├── package-lock.json
├── analise-de-cobertura-92fcbc2f5306.json
└── credenciais.json
```

- **Dockerfile**: Definições da imagem Docker, instalação de dependências e comando de entrada.
- **index.mjs**: Exemplo de renovação de token via Google Secret Manager.
- **coleta.mjs**: Script principal de coleta, processamento e atualização de planilha.
- **metadata.json**: Controle da data da última execução (`lastRun`).
- **compras_cache.json** / **vendas_cache.json**: Caches de dados para evitar requisições repetidas.
- **package.json** / **package-lock.json**: Listagem de dependências Node.js.
- **analise-de-cobertura-*.json**: Credenciais de serviço GCP.
- **credenciais.json**: Credenciais Bling para desenvolvimento local.

## Dependências

- **Node.js** (v16+)
- **@google-cloud/secret-manager**
- **@google-cloud/storage**
- **axios**
- **googleapis**
- **dotenv** (opcional)

## Instalação e Configuração

1. Clone o repositório.
2. Execute `npm install` para instalar as dependências.
3. Configure credenciais:
   - Coloque a chave de serviço GCP (`analise-de-cobertura-*.json`) na raiz.
   - Para desenvolvimento local, use `credenciais.json` com `client_id`, `client_secret`, `refresh_token`.
4. Crie um bucket Cloud Storage para armazenar `metadata.json`.

## Uso Local

```bash
npm install
node coleta.mjs
```

O script irá:
1. Baixar `metadata.json` do bucket (ou criar se não existir).
2. Coletar pedidos de compra e venda paginados do Bling.
3. Processar dados (última entrada, parcelas, quantidades, saldo).
4. Atualizar a planilha Google Sheets.
5. Atualizar e enviar `metadata.json` ao bucket.

## Deploy com Docker e Google Cloud

```bash
# Build da imagem
docker build -t gcr.io/analise-de-cobertura/coleta-bling-job:latest .

# Push para Artifact Registry
docker push gcr.io/analise-de-cobertura/coleta-bling-job:latest

# Atualizar Cloud Run Job
gcloud beta run jobs update coleta-bling-job   --region=us-central1   --image=gcr.io/analise-de-cobertura/coleta-bling-job:latest

# Executar o Job
gcloud beta run jobs execute coleta-bling-job --region=us-central1

# Verificar logs
gcloud beta run jobs executions logs list coleta-bling-job --region=us-central1 --execution=latest
```

## Principais Funções

- **carregarCredenciais()**: Lê token do Secret Manager e retorna `ACCESS_TOKEN` e `BLING_API_URL`.
- **loadMetadata() / saveMetadata()**: Gerenciam `metadata.json` de controle de data.
- **loadCache() / saveCache()**: Gerenciam caches locais de JSON.
- **coletarCompras() / coletarVendas()**: Funções de paginação e filtragem de pedidos.
- **consultarSaldo()**: Busca saldo de estoque para SKUs.
- **updateSheets()**: Atualiza planilha Google Sheets.

## Rate Limiting e Contagem Diário

- Máximo de 3 requisições por segundo (intervalo ~334ms) via `RateLimiter`.
- Máximo de 120.000 requisições por dia, controle com `dailyCount` e reset diário.

## Contribuição

1. Abra uma issue descrevendo a proposta.
2. Faça um fork e crie uma branch de feature.
3. Envie um pull request detalhando mudanças.
