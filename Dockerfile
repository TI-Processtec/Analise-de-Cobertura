# Usar uma imagem Node.js oficial como base
FROM node:16

# Definir o diretório de trabalho dentro do container
WORKDIR /usr/src/app

# Copiar o package.json e o package-lock.json para o diretório de trabalho
COPY package*.json ./

# Instalar as dependências do projeto
RUN npm install

# Copiar o restante do código (incluindo o script e os arquivos de cache e credenciais)
COPY . .

# Copiar arquivos de credenciais e cache para o container
COPY analise-de-cobertura-92fcbc2f5306.json /usr/src/app/
COPY compras_cache.json /usr/src/app/
COPY vendas_cache.json /usr/src/app/
COPY index.mjs /usr/src/app/

# Expor a porta que o Cloud Run usa por padrão
EXPOSE 8080

# Comando para rodar seu código no container
CMD ["node", "coleta.mjs"]
