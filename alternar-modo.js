#!/usr/bin/env node

// Script auxiliar para alternar o modo facilmente
const { execSync } = require("child_process");
const path = require("path");

try {
    console.log("🔄 Alternando modo do proxy...\n");
    
    // Para o updater temporariamente
    try {
        execSync("pm2 stop updater", { stdio: "inherit" });
    } catch (e) {}
    
    // Executa o switch mode
    execSync("node auto-update.js --switch-mode", {
        stdio: "inherit",
        cwd: path.join(__dirname, "..")
    });
    
    // Reinicia o updater
    execSync("pm2 restart updater", { stdio: "inherit" });
    
    console.log("\n✅ Modo alterado com sucesso!");
    
} catch (err) {
    console.error("❌ Erro:", err.message);
}