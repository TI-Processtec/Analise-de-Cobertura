// Importações usando ES Modules
import fetch from 'node-fetch';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

// Instância do Google Secret Manager
const client = new SecretManagerServiceClient();

// Nome do segredo único no Secret Manager
const SECRET_NAME = 'projects/analise-de-cobertura/secrets/Credenciais-API-Bling/versions/latest';

// Função para buscar o segredo único do Secret Manager
async function getSecret(secretName) {
    try {
        console.log(`Buscando segredo do Secret Manager: ${secretName}`);
        const [version] = await client.accessSecretVersion({ name: secretName });
        const secretData = version.payload.data.toString();
        console.log(`Segredo encontrado: ${secretData}`);
        return JSON.parse(secretData); // Parse JSON para extrair as credenciais
    } catch (error) {
        console.error(`Erro ao buscar o segredo: ${error.message}`);
        throw new Error(`Erro ao buscar o segredo: ${error.message}`);
    }
}

// Função para salvar uma nova versão do segredo no Secret Manager
async function saveSecret(secretName, newSecretValue) {
    try {
        console.log(`Salvando novo segredo no Secret Manager: ${secretName}`);
        await client.addSecretVersion({
            parent: secretName.split("/versions/")[0], // Remove o "/versions/latest"
            payload: { data: Buffer.from(JSON.stringify(newSecretValue), 'utf8') },
        });
        console.log('Novo segredo salvo com sucesso!');
    } catch (error) {
        console.error(`Erro ao salvar o segredo: ${error.message}`);
        throw new Error(`Erro ao salvar o segredo: ${error.message}`);
    }
}

// Função para renovar o access token usando o refresh token
async function refreshAccessToken() {
    try {
        console.log('Iniciando processo de renovação do access token...');
        
        // Recuperar as credenciais do Google Secret Manager
        const credentials = await getSecret(SECRET_NAME);
        const CLIENT_ID = credentials.client_id ? credentials.client_id.trim() : null;
        const CLIENT_SECRET = credentials.client_secret ? credentials.client_secret.trim() : null;
        const REFRESH_TOKEN = credentials.refresh_token ? credentials.refresh_token.trim() : null;
        const BLING_API_URL = credentials.bling_api_url ? credentials.bling_api_url.trim() : null;

        // Verificação das variáveis carregadas
        if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !BLING_API_URL) {
            console.error('Erro: Credenciais não carregadas corretamente.');
            throw new Error('Credenciais não foram carregadas corretamente. Abortando execução.');
        }

        console.log('=== Credenciais carregadas ===');
        console.log(`CLIENT_ID: ${CLIENT_ID}`);
        console.log(`CLIENT_SECRET: ${CLIENT_SECRET}`);
        console.log(`REFRESH_TOKEN: ${REFRESH_TOKEN}`);
        console.log(`BLING_API_URL: ${BLING_API_URL}`);
        console.log('=============================');

        // Configuração do Basic Auth
        const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
        const payload = `grant_type=refresh_token&refresh_token=${REFRESH_TOKEN}`;

        console.log('Enviando requisição para renovar o access token...');
        const response = await fetch(BLING_API_URL, {
            method: 'POST',
            body: payload,
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            }
        });

        const responseText = await response.text();
        console.log(`Resposta completa da API: ${responseText}`);

        if (!response.ok) {
            console.error(`Erro ao renovar o access token. Status: ${response.status}`);
            throw new Error(`Erro na requisição: ${response.status}`);
        }

        // Converter a resposta para JSON e salvar tokens
        const json = JSON.parse(responseText);
        if (json.access_token && json.refresh_token) {
            console.log('Novo Access Token e Refresh Token gerados com sucesso.');
            credentials.access_token = json.access_token;
            credentials.refresh_token = json.refresh_token;

            await saveSecret(SECRET_NAME, credentials); // Salvar os tokens atualizados
            logRefreshTime();
        } else {
            console.error('Erro na resposta da API ao tentar renovar os tokens:', json);
        }
    } catch (error) {
        console.error('Erro ao renovar o access token:', error.message);
    }
}

// Função para registrar a data e hora da última renovação
function logRefreshTime() {
    const date = new Date();
    const formattedDate = date.toLocaleDateString('pt-BR');
    const formattedTime = date.toLocaleTimeString('pt-BR');
    console.log(`Access token atualizado em ${formattedDate} às ${formattedTime}`);
}

// Função para obter o access token atualizado para usar em requisições subsequentes
async function getAccessToken() {
    try {
        console.log('Buscando access token atualizado...');
        const credentials = await getSecret(SECRET_NAME);
        console.log(`Access token encontrado: ${credentials.access_token}`);
        return credentials.access_token;
    } catch (error) {
        console.error(`Erro ao buscar o access token: ${error.message}`);
    }
}

// Exemplo de uso: Obter o access token e utilizá-lo para alguma requisição
async function fazerRequisicaoComAccessToken() {
    try {
        const accessToken = await getAccessToken();
        const response = await fetch('https://api.bling.com.br/alguma_api', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await response.json();
        console.log('Resposta da requisição:', data);
    } catch (error) {
        console.error('Erro ao fazer a requisição com access token:', error.message);
    }
}

// Executa a função imediatamente quando o script é iniciado
refreshAccessToken();
