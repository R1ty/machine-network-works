const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const appPath = path.join(__dirname, "machine-network-works");
const configPath = path.join(__dirname, "updater-config.json");
const repoURL = "https://github.com/R1ty/machine-network-works.git";
const branch = "main";
const appName = "machine-network-works";

// Configuração padrão
let config = {
    mode: null, // 'server' ou 'worker'
    startScript: null // 'start:server' ou 'start:worker'
};

// Carrega configuração se existir
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        console.log(`📋 Configuração carregada: Modo ${config.mode}`);
    } catch (err) {
        console.log("⚠️ Erro ao ler config, usando padrão");
    }
}

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.toLowerCase());
    }));
}

async function selectMode() {
    console.log("\n🔧 Primeira execução - Selecione o modo de operação:");
    console.log("1) Server - Para executar como servidor principal");
    console.log("2) Worker - Para executar como worker/cliente");
    
    let answer = await askQuestion("Escolha 1 ou 2: ");
    
    while (answer !== '1' && answer !== '2') {
        console.log("❌ Opção inválida! Digite 1 ou 2.");
        answer = await askQuestion("Escolha 1 ou 2: ");
    }
    
    if (answer === '1') {
        config.mode = 'server';
        config.startScript = 'start:server';
        console.log("✅ Modo SERVER selecionado");
    } else {
        config.mode = 'worker';
        config.startScript = 'start:worker';
        console.log("✅ Modo WORKER selecionado");
    }
    
    // Salva configuração
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`💾 Configuração salva em ${configPath}`);
}

function run(cmd, cwd = null) {
    return new Promise((resolve, reject) => {
        const options = cwd ? { cwd } : {};
        exec(cmd, options, (err, stdout, stderr) => {
            if (err) {
                console.error(`Erro no comando: ${cmd}`);
                console.error(stderr || err.message);
                return reject(err);
            }
            resolve(stdout);
        });
    });
}

async function buildProject() {
    console.log("🏗️ Buildando o projeto...");
    try {
        await run("pnpm run build", appPath);
        console.log("✅ Build concluído!");
    } catch (err) {
        throw new Error(`Falha no build: ${err.message}`);
    }
}

async function atualizarOuInstalar() {
    try {
        let precisaBuild = false;

        if (!fs.existsSync(appPath)) {
            console.log("📦 Clonando app...");
            await run(`git clone -b ${branch} ${repoURL} ${appPath}`);
            precisaBuild = true;
        } else {
            console.log("🔄 Verificando atualizações...");
            
            await run(`cd ${appPath} && git fetch origin ${branch}`);
            const localCommit = await run(`cd ${appPath} && git rev-parse HEAD`);
            const remoteCommit = await run(`cd ${appPath} && git rev-parse origin/${branch}`);
            
            if (localCommit.trim() !== remoteCommit.trim()) {
                console.log("⬇️ Atualização encontrada! Baixando...");
                await run(`cd ${appPath} && git pull origin ${branch}`);
                precisaBuild = true;
            } else {
                console.log("✅ App já está atualizado");
            }
        }

        if (precisaBuild) {
            console.log("📦 Instalando dependências...");
            await run("pnpm install", appPath);
            await buildProject();
        } else {
            if (!fs.existsSync(path.join(appPath, "node_modules"))) {
                console.log("📦 Instalando dependências...");
                await run("pnpm install", appPath);
                await buildProject();
            }
        }

        // Se não tiver modo configurado, pergunta ao usuário
        if (!config.mode) {
            await selectMode();
        }

        await restartApp();

    } catch (err) {
        console.error("❌ Erro na atualização:", err.message);
    }
}

async function restartApp() {
    try {
        if (!config.mode || !config.startScript) {
            console.log("⚠️ Modo não configurado! Aguardando configuração...");
            await selectMode();
        }

        console.log(`🚀 Iniciando app no modo: ${config.mode}`);
        
        // Para o processo antigo se existir
        try {
            const list = await run("pm2 list");
            if (list.includes(appName)) {
                console.log("🔄 Parando instância antiga...");
                await run(`pm2 delete ${appName}`);
            }
        } catch (e) {
            // Ignora erro
        }
        
        // Inicia com o script correto baseado no modo
        console.log(`📝 Executando: pnpm run ${config.startScript}`);
        await run(`cd ${appPath} && pm2 start pnpm --name ${appName} -- run ${config.startScript}`);
        
        // Salva a lista do PM2
        await run("pm2 save");
        
        console.log(`✅ App iniciado com sucesso no modo ${config.mode}!`);
        console.log(`📝 Logs: pm2 logs ${appName}`);
        
    } catch (err) {
        console.error("❌ Erro ao reiniciar app:", err.message);
    }
}

// Função para alternar modo manualmente
async function switchMode() {
    console.log("\n🔄 Alternando modo de operação...");
    await selectMode();
    await restartApp();
}

// Processa argumentos da linha de comando
if (process.argv.includes('--switch-mode')) {
    switchMode();
} else {
    // Função principal
    async function main() {
        console.log("🚀 Iniciando sistema de auto-update...");
        console.log(`📁 Caminho do app: ${appPath}`);
        
        // Executa imediatamente
        await atualizarOuInstalar();
        
        // Depois executa a cada 5 minutos
        setInterval(async () => {
            console.log("\n🕐 Verificando atualizações...");
            await atualizarOuInstalar();
        }, 1000 * 60 * 5);
    }

    // Tratamento de erros
    process.on('unhandledRejection', (err) => {
        console.error('Erro não tratado:', err);
    });

    main();
}