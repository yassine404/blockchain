#!/usr/bin/env node

const readline = require("readline");
const fs       = require("fs");
const EC       = require("elliptic").ec;
const ec       = new EC("secp256k1");

const Blockchain    = require("./blockchain");
const Transaction   = require("./transaction");
const P2P           = require("./p2p");

// ─── Persistence files ────────────────────────────────────────────────────────
const CHAIN_FILE   = "./chain.json";
const WALLETS_FILE = "./wallets.json";

// ─── Load / Save helpers ──────────────────────────────────────────────────────

function saveChain(blockchain) {
    fs.writeFileSync(CHAIN_FILE, JSON.stringify(blockchain.chain, null, 2));
}

function loadChain(blockchain) {
    if (!fs.existsSync(CHAIN_FILE)) return;
    try {
        const raw   = JSON.parse(fs.readFileSync(CHAIN_FILE));
        const Block = require("./block");

        blockchain.chain = raw.map(b => {
            const block = Object.assign(new Block(0, 0, [], ""), b);
            if (Array.isArray(block.transactions)) {
                block.transactions = block.transactions.map(t =>
                    Object.assign(new Transaction(null, null, 0), t)
                );
            }
            return block;
        });
    } catch (e) {
        console.error("Erreur chargement chain:", e.message);
    }
}

function saveWallets(wallets) {
    const data = {};
    for (const [name, key] of Object.entries(wallets)) {
        data[name] = key.getPrivate("hex");
    }
    fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
}

function loadWallets() {
    const wallets = {};
    if (!fs.existsSync(WALLETS_FILE)) return wallets;
    try {
        const data = JSON.parse(fs.readFileSync(WALLETS_FILE));
        for (const [name, privHex] of Object.entries(data)) {
            wallets[name] = ec.keyFromPrivate(privHex, "hex");
        }
    } catch (e) {
        console.error("Erreur chargement wallets:", e.message);
    }
    return wallets;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const myBlockchain = new Blockchain();
loadChain(myBlockchain);
console.log(`Blockchain chargee (${myBlockchain.chain.length} blocs).`);

const wallets = loadWallets();
console.log(`${Object.keys(wallets).length} wallets charges.`);

const p2p = new P2P(myBlockchain);
myBlockchain.p2p = p2p;

// Quand le P2P adopte une chaîne plus longue → sauvegarder automatiquement
p2p.onChainUpdate = () => {
    saveChain(myBlockchain);
    console.log("Chaine mise a jour et sauvegardee.");
};

// ─── P2P : démarrage avec fallback de port ────────────────────────────────────
// Utilise la variable d'environnement P2P_PORT ou 8888 par défaut
// Lancement : P2P_PORT=8889 node Main.js
const BASE_PORT = parseInt(process.env.P2P_PORT) || 8888;

function tryListen(port) {
    const { WebSocketServer } = require("ws");
    const server = new WebSocketServer({ port });

    server.on("error", err => {
        if (err.code === "EADDRINUSE") {
            console.warn(`Port ${port} occupe, essai sur ${port + 1}...`);
            server.close();
            tryListen(port + 1);
        } else {
            console.error("Erreur P2P serveur:", err.message);
        }
    });

    server.on("listening", () => {
        console.log(`Serveur P2P sur port ${port}`);
        p2p.port = port;
        server.on("connection", socket => {
            console.log(`Nouveau pair connecte sur port ${port}`);
            p2p.initConnection(socket);
            // Le nouveau pair nous demande notre chaîne au moment de la connexion
            // (géré automatiquement dans p2p.connectToPeer côté client)
        });
    });
}

tryListen(BASE_PORT);

// ─── Current wallet state ─────────────────────────────────────────────────────
let currentWalletName = null;
let currentKeyPair    = null;

// ─── Readline interface ───────────────────────────────────────────────────────
const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// ─── Menu ─────────────────────────────────────────────────────────────────────

function printMenu() {
    console.log("\n=== MENU BLOCKCHAIN ===");
    console.log("1. Creer un wallet");
    console.log("2. Choisir wallet courant");
    console.log("3. Afficher solde");
    console.log("4. Envoyer des coins (transaction)");
    console.log("5. Miner le bloc suivant");
    console.log("6. Afficher la blockchain");
    console.log("7. Se connecter a un pair (P2P)");
    console.log("8. Quitter");
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCreateWallet() {
    const name = (await ask("Nom du wallet : ")).trim();
    if (!name)         { console.log("Nom invalide.");                  return; }
    if (wallets[name]) { console.log(`Wallet '${name}' existe deja.`); return; }

    const keyPair = ec.genKeyPair();
    wallets[name] = keyPair;
    saveWallets(wallets);

    console.log(`Wallet '${name}' cree.`);
    console.log(`  Cle publique  : ${keyPair.getPublic("hex")}`);
    console.log(`  Cle privee    : ${keyPair.getPrivate("hex")}  (garder secrete !)`);
}

async function handleChooseWallet() {
    const name = (await ask("Nom du wallet : ")).trim();
    if (!wallets[name]) { console.log(`Wallet '${name}' introuvable.`); return; }

    currentWalletName = name;
    currentKeyPair    = wallets[name];
    console.log(`Wallet '${name}' selectionne.`);
}

function handleShowBalance() {
    if (!currentKeyPair) { console.log("Aucun wallet selectionne."); return; }
    const address = currentKeyPair.getPublic("hex");
    const balance = myBlockchain.getBalanceOfAddress(address);
    console.log(`Solde de ${currentWalletName} : ${balance.toFixed(2)}`);
}

async function handleSendCoins() {
    if (!currentKeyPair) { console.log("Aucun wallet selectionne."); return; }

    const toAddress = (await ask("Adresse destinataire (cle publique hex) : ")).trim();
    const amountStr = (await ask("Montant : ")).trim();
    const amount    = parseFloat(amountStr);

    if (isNaN(amount) || amount <= 0) { console.log("Montant invalide."); return; }

    try {
        const tx = new Transaction(currentKeyPair.getPublic("hex"), toAddress, amount);
        tx.signTransaction(currentKeyPair);
        myBlockchain.createTransaction(tx);
        console.log("Transaction ajoutee en attente.");
    } catch (e) {
        console.error("Erreur transaction:", e.message);
    }
}

function handleMineBlock() {
    if (!currentKeyPair) { console.log("Aucun wallet selectionne."); return; }

    
    try {
        myBlockchain.minePendingTransaction(currentKeyPair.getPublic("hex"));
        saveChain(myBlockchain);
        console.log("Bloc mine et sauvegarde.");
    } catch (e) {
        console.error("Bloc invalide, non ajoute.", e.message);
    }
}

function handleShowChain() {
    console.log("\n=== BLOCKCHAIN ===");
    for (const block of myBlockchain.chain) {
        console.log(`\nBloc #${block.index}`);
        console.log(`  Timestamp     : ${new Date(block.timetamp).toISOString()}`);
        console.log(`  PreviousHash  : ${block.previousHash}`);
        console.log(`  Hash          : ${block.hash}`);
        console.log(`  Nonce         : ${block.nonce}`);

        if (Array.isArray(block.transactions)) {
            console.log(`  Transactions  : ${block.transactions.length}`);
            for (const tx of block.transactions) {
                const from = tx.fromAddress ? tx.fromAddress.substring(0, 20) + "..." : "COINBASE";
                const to   = tx.toAddress   ? tx.toAddress.substring(0, 20)   + "..." : "?";
                console.log(`    ${from} -> ${to}  |  ${tx.amount} coins`);
            }
        } else {
            console.log(`  Data : ${block.transactions}`);
        }
    }

    try {
        console.log(`\nChaine valide : ${myBlockchain.isChainValid()}`);
    } catch (e) {
        console.error("Erreur validation chaine:", e.message);
    }
}

async function handleConnectPeer() {
    const input = (await ask("Adresse du pair (ex: ws://localhost:8889 ou juste le port) : ")).trim();

    let address;
    if (/^\d+$/.test(input)) {
        address = `ws://localhost:${input}`;
    } else if (input.startsWith("ws://") || input.startsWith("wss://")) {
        address = input;
    } else {
        console.error(`Adresse invalide : '${input}'`);
        console.error(`  → Utilise ws://host:port  ou  juste un numero de port`);
        return;
    }

    p2p.connectToPeer(address);
    // La synchronisation de chaîne se fait automatiquement via QUERY_ALL dans connectToPeer
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function mainLoop() {
    while (true) {
        printMenu();
        const choice = (await ask("Choix : ")).trim();

        switch (choice) {
            case "1": await handleCreateWallet(); break;
            case "2": await handleChooseWallet(); break;
            case "3":       handleShowBalance();  break;
            case "4": await handleSendCoins();    break;
            case "5":       handleMineBlock();    break;
            case "6":       handleShowChain();    break;
            case "7": await handleConnectPeer();  break;
            case "8":
                console.log("Au revoir !");
                rl.close();
                process.exit(0);
            default:
                console.log("Choix invalide.");
        }
    }
}

mainLoop();