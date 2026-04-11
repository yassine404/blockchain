const fs = require("fs");
const Wallet = require("./wallet");

// Suffixe pour différencier les fichiers de persistance (par exemple "_8888")
let DATA_SUFFIX = "";

function setDataSuffix(suffix) {
    DATA_SUFFIX = suffix ? `_${suffix}` : "";
}

function getChainFile() {
    return `./chain${DATA_SUFFIX}.json`;
}

function getWalletsFile() {
    return `./wallets${DATA_SUFFIX}.json`;
}

function saveChain(blockchain) {
    fs.writeFileSync(getChainFile(), JSON.stringify(blockchain.chain, null, 2));
}

function loadChain(blockchain) {
    const file = getChainFile();
    if (!fs.existsSync(file)) return;
    try {
        const raw = JSON.parse(fs.readFileSync(file));
        const Block = require("./block");
        const Transaction = require("./transaction");

        blockchain.chain = raw.map(b => {
            const block = Object.assign(new Block(0, 0, [], ""), b);
            if (Array.isArray(block.transactions)) {
                block.transactions = block.transactions.map(t => {
                    const tx = new Transaction();
                    Object.assign(tx, t);
                    return tx;
                });
            }
            return block;
        });
        // Reconstruire l'UTXO set après chargement
        blockchain._buildUTXOset();
    } catch (e) {
        console.error("Erreur chargement chain:", e.message);
    }
}

function saveWallets(wallets) {
    const data = {};
    for (const [name, wallet] of Object.entries(wallets)) {
        data[name] = wallet.getPrivateKey();
    }
    fs.writeFileSync(getWalletsFile(), JSON.stringify(data, null, 2));
}

function loadWallets() {
    const wallets = {};
    const file = getWalletsFile();
    if (!fs.existsSync(file)) return wallets;
    try {
        const data = JSON.parse(fs.readFileSync(file));
        for (const [name, privHex] of Object.entries(data)) {
            wallets[name] = new Wallet(privHex);
        }
    } catch (e) {
        console.error("Erreur chargement wallets:", e.message);
    }
    return wallets;
}

module.exports = {
    setDataSuffix,
    saveChain,
    loadChain,
    saveWallets,
    loadWallets
};