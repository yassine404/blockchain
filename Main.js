#!/usr/bin/env node

const readline = require("readline");
const Blockchain = require("./blockchain");
const Transaction = require("./transaction");
const P2P = require("./p2p");
const Wallet = require("./wallet");
const { saveChain, loadChain, saveWallets, loadWallets } = require("./storage");

// ─── Initialisation Blockchain ────────────────────────────────────────────────
const myBlockchain = new Blockchain();
loadChain(myBlockchain);
console.log(`Blockchain chargée (${myBlockchain.chain.length} blocs).`);

// ─── Chargement des wallets ───────────────────────────────────────────────────
const wallets = loadWallets();
console.log(`${Object.keys(wallets).length} wallets chargés.`);

// ─── P2P ──────────────────────────────────────────────────────────────────────
const p2p = new P2P(myBlockchain);
myBlockchain.p2p = p2p;
p2p.onChainUpdate = () => {
    saveChain(myBlockchain);
    console.log("Chaîne mise à jour et sauvegardée.");
};

const BASE_PORT = parseInt(process.env.P2P_PORT) || 8888;
p2p.listen(BASE_PORT);   // la méthode listen gère le fallback de port

// ─── État courant ─────────────────────────────────────────────────────────────
let currentWallet = null;   // instance de Wallet

// ─── Interface readline ───────────────────────────────────────────────────────
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

// ─── Menu ─────────────────────────────────────────────────────────────────────
function printMenu() {
    console.log("\n=== MENU BLOCKCHAIN (UTXO) ===");
    console.log("1. Créer un wallet");
    console.log("2. Choisir wallet courant");
    console.log("3. Afficher solde");
    console.log("4. Envoyer des coins (transaction UTXO)");
    console.log("5. Miner le bloc suivant");
    console.log("6. Afficher la blockchain");
    console.log("7. Afficher les UTXOs du wallet courant");
    console.log("8. Se connecter à un pair (P2P)");
    console.log("9. Quitter");
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleCreateWallet() {
    const name = (await ask("Nom du wallet : ")).trim();
    if (!name) {
        console.log("Nom invalide.");
        return;
    }
    if (wallets[name]) {
        console.log(`Wallet '${name}' existe déjà.`);
        return;
    }

    const wallet = new Wallet();
    wallets[name] = wallet;
    saveWallets(wallets);

    console.log(`Wallet '${name}' créé.`);
    console.log(`  Adresse (P2PKH) : ${wallet.getAddress()}`);
    console.log(`  Clé privée       : ${wallet.getPrivateKey()}  (gardez-la secrète !)`);
}

async function handleChooseWallet() {
    const name = (await ask("Nom du wallet : ")).trim();
    if (!wallets[name]) {
        console.log(`Wallet '${name}' introuvable.`);
        return;
    }
    currentWallet = wallets[name];
    console.log(`Wallet '${name}' sélectionné.`);
    console.log(`  Adresse : ${currentWallet.getAddress()}`);
}

function handleShowBalance() {
    if (!currentWallet) {
        console.log("Aucun wallet sélectionné.");
        return;
    }
    const address = currentWallet.getAddress();
    const balance = myBlockchain.getBalanceOfAddress(address);
    console.log(`Solde de ${currentWallet.getAddress().substring(0, 15)}... : ${balance.toFixed(2)}`);
}

async function handleSendCoins() {
    if (!currentWallet) {
        console.log("Aucun wallet sélectionné.");
        return;
    }

    const toAddress = (await ask("Adresse destinataire : ")).trim();
    const amountStr = (await ask("Montant : ")).trim();
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        console.log("Montant invalide.");
        return;
    }

    const myAddress = currentWallet.getAddress();
    const utxos = myBlockchain.getUTXOsForAddress(myAddress);
    if (utxos.length === 0) {
        console.log("Aucun UTXO disponible.");
        return;
    }

    // Sélection simple : on prend les UTXOs dans l'ordre jusqu'à avoir assez
    let selected = [];
    let total = 0;
    for (const utxo of utxos) {
        selected.push(utxo);
        total += utxo.amount;
        if (total >= amount) break;
    }

    if (total < amount) {
        console.log(`Solde insuffisant. Disponible : ${total}`);
        return;
    }

    const tx = new Transaction();
    // Ajouter les inputs
    selected.forEach(utxo => {
        tx.addInput(utxo.txid, utxo.outputIndex, currentWallet.publicKey);
    });

    // Output destinataire
    tx.addOutput(toAddress, amount);

    // Change (si reste)
    const change = total - amount;
    if (change > 0) {
        tx.addOutput(myAddress, change);
    }

    // Signer chaque input
    try {
        selected.forEach((_, idx) => {
            currentWallet.signTransaction(tx, idx);
        });

        // Valider et ajouter au pool
        if (tx.isValid(myBlockchain.utxoSet)) {
            myBlockchain.pendingTransactions.push(tx);
            console.log("Transaction créée et ajoutée au pool en attente.");
        } else {
            console.log("Transaction invalide (échec validation).");
        }
    } catch (e) {
        console.error("Erreur lors de la signature :", e.message);
    }
}

function handleMineBlock() {
    if (!currentWallet) {
        console.log("Aucun wallet sélectionné (utilisé pour recevoir la récompense).");
        return;
    }

    try {
        myBlockchain.minePendingTransaction(currentWallet.getAddress());
        saveChain(myBlockchain);
        console.log("Bloc miné et sauvegardé.");
    } catch (e) {
        console.error("Erreur lors du minage :", e.message);
    }
}

function handleShowChain() {
    console.log("\n=== BLOCKCHAIN ===");
    for (const block of myBlockchain.chain) {
        console.log(`\nBloc #${block.index}`);
        console.log(`  Timestamp    : ${new Date(block.timetamp).toISOString()}`);
        console.log(`  PreviousHash : ${block.previousHash}`);
        console.log(`  Hash         : ${block.hash}`);
        console.log(`  Nonce        : ${block.nonce}`);

        if (Array.isArray(block.transactions)) {
            console.log(`  Transactions : ${block.transactions.length}`);
            for (const tx of block.transactions) {
                // Affichage simplifié UTXO
                const inputSummary = tx.inputs.map(i => i.txid.substring(0, 8) + "..." + i.outputIndex).join(", ");
                const outputSummary = tx.outputs.map(o => `${o.amount}→${o.address.substring(0, 10)}...`).join(", ");
                console.log(`    Inputs: [${inputSummary}]  Outputs: [${outputSummary}]`);
            }
        } else {
            console.log(`  Data : ${block.transactions}`);
        }
    }

    console.log(`\nChaîne valide : ${myBlockchain.isChainValid()}`);
}

function handleShowUTXOs() {
    if (!currentWallet) {
        console.log("Aucun wallet sélectionné.");
        return;
    }
    const address = currentWallet.getAddress();
    const utxos = myBlockchain.getUTXOsForAddress(address);
    console.log(`\nUTXOs pour ${address.substring(0, 15)}... :`);
    utxos.forEach((utxo, i) => {
        console.log(`  ${i}: txid=${utxo.txid.substring(0, 10)}... idx=${utxo.outputIndex} montant=${utxo.amount}`);
    });
    console.log(`Total : ${utxos.reduce((sum, u) => sum + u.amount, 0)}`);
}

async function handleConnectPeer() {
    const input = (await ask("Adresse du pair (ex: ws://localhost:8889 ou juste le port) : ")).trim();
    let address;
    if (/^\d+$/.test(input)) {
        address = `ws://localhost:${input}`;
    } else if (input.startsWith("ws://") || input.startsWith("wss://")) {
        address = input;
    } else {
        console.error("Adresse invalide. Utilisez ws://host:port ou un numéro de port.");
        return;
    }
    p2p.connectToPeer(address);
}

// ─── Boucle principale ────────────────────────────────────────────────────────
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
            case "7":       handleShowUTXOs();    break;
            case "8": await handleConnectPeer();  break;
            case "9":
                console.log("Au revoir !");
                rl.close();
                process.exit(0);
            default:
                console.log("Choix invalide.");
        }
    }
}

mainLoop().catch(err => console.error("Erreur fatale :", err));