const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readline = require("readline");

const source = path.join(__dirname, "..", "auto-update.js");
const destination = path.join(__dirname, "..", "..", "auto-update.js");
const configPath = path.join(__dirname, "..", "..", "updater-config.json");
const projectRoot = path.join(__dirname, "..");
const parentDir = path.join(projectRoot, "..");

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function setup() {
    try {
        console.log("🚀 Setup do Auto-Update\n");

        // Pergunta o modo na primeira instalação
        console.log("Selecione o modo de operação:");
        console.log("1) Server - Para executar como servidor principal");
        console.log("2) Worker - Para executar como worker/cliente");
        
        let answer = await askQuestion("Escolha 1 ou 2: ");
        
        while (answer !== '1' && answer !== '2') {
            console.log("❌ Opção inválida! Digite 1 ou 2.");
            answer = await askQuestion("Escolha 1 ou 2: ");
        }
        
        const mode = answer === '1' ? 'server' : 'worker';
        const startScript = answer === '1' ? 'start:server' : 'start:worker';
        
        console.log(`\n✅ Modo ${mode.toUpperCase()} selecionado`);

        if (!fs.existsSync(destination)) {
            console.log("\n📋 Copiando auto-update.js...");
            fs.copyFileSync(source, destination);
            console.log("✅ auto-update.js copiado para fora da pasta.");

            // Salva configuração inicial
            const config = {
                mode: mode,
                startScript: startScript
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            console.log(`💾 Configuração salva em ${configPath}`);

            console.log("\n📦 Instalando dependências do projeto...");
            execSync("pnpm install", { stdio: "inherit", cwd: projectRoot });

            console.log("\n🏗️ Buildando o projeto...");
            execSync("pnpm run build", { stdio: "inherit", cwd: projectRoot });

            console.log("\n🚀 Iniciando updater no PM2...");
            
            // Para o updater antigo se existir
            try {
                execSync("pm2 delete updater", { stdio: "ignore" });
            } catch (e) {}
            
            // Inicia o novo updater
            execSync("pm2 start auto-update.js --name updater", {
                stdio: "inherit",
                cwd: parentDir
            });
            
            console.log("\n✅ Setup concluído com sucesso!");
            console.log("\n📝 Comandos úteis:");
            console.log("   - Ver logs: pm2 logs updater");
            console.log("   - Ver status: pm2 status");
            console.log("   - Alternar modo: cd .. && node auto-update.js --switch-mode");

        } else {
            console.log("\n⚠️ auto-update.js já existe.");
            console.log("\n👉 Opções:");
            console.log("   1) Para atualizar o updater manualmente:");
            console.log("      pm2 delete updater");
            console.log("      node scripts/setup.js");
            console.log("\n   2) Para alternar o modo de operação:");
            console.log("      cd .. && node auto-update.js --switch-mode");
        }

    } catch (err) {
        console.error("\n❌ Erro no setup:", err.message);
        process.exit(1);
    }
}

// Executa setup
setup();