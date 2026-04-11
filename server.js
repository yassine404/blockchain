const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const cors = require("cors");

const Blockchain = require("./blockchain");
const Transaction = require("./transaction");
const P2P = require("./p2p");
const Wallet = require("./wallet");
const { setDataSuffix, loadChain, saveChain, loadWallets, saveWallets } = require("./storage");

// ─── Configuration du nœud ─────────────────────────────────────────────────
const BASE_PORT = parseInt(process.env.P2P_PORT) || 8888;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

setDataSuffix(BASE_PORT);

const myBlockchain = new Blockchain();
loadChain(myBlockchain);
console.log(`Blockchain chargée (${myBlockchain.chain.length} blocs).`);

const wallets = loadWallets();
console.log(`${Object.keys(wallets).length} wallets chargés.`);

const p2p = new P2P(myBlockchain);
myBlockchain.p2p = p2p;
p2p.onChainUpdate = () => {
    saveChain(myBlockchain);
    console.log("Chaîne mise à jour et sauvegardée.");
    // Notifier tous les clients web
    io.emit("blockchain_update", {
        chainLength: myBlockchain.chain.length,
        latestBlock: myBlockchain.getLatestBlock()
    });
};

p2p.listen(BASE_PORT);

// ─── Serveur Express + Socket.IO ──────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Stockage du wallet courant (pour la session web, simplifié)
let currentWallet = null;

// ─── API REST ─────────────────────────────────────────────────────────────

// Récupérer les wallets disponibles (noms uniquement, pas de clés privées)
app.get("/api/wallets", (req, res) => {
    const walletNames = Object.keys(wallets);
    res.json(walletNames);
});

// Créer un nouveau wallet
app.post("/api/wallet", (req, res) => {
    const { name } = req.body;
    if (!name || wallets[name]) {
        return res.status(400).json({ error: "Nom invalide ou déjà utilisé" });
    }
    const wallet = new Wallet();
    wallets[name] = wallet;
    saveWallets(wallets);
    res.json({
        name,
        address: wallet.getAddress()
        // Ne pas renvoyer la clé privée en production !
    });
});

// Sélectionner le wallet courant (pour la session)
app.post("/api/wallet/select", (req, res) => {
    const { name } = req.body;
    if (!wallets[name]) {
        return res.status(404).json({ error: "Wallet introuvable" });
    }
    currentWallet = wallets[name];
    res.json({
        name,
        address: currentWallet.getAddress(),
        balance: myBlockchain.getBalanceOfAddress(currentWallet.getAddress())
    });
});

// Obtenir les infos du wallet courant
app.get("/api/wallet/current", (req, res) => {
    if (!currentWallet) {
        return res.json(null);
    }
    res.json({
        name: currentWallet.name, // à stocker si besoin
        address: currentWallet.getAddress(),
        balance: myBlockchain.getBalanceOfAddress(currentWallet.getAddress()),
        utxos: myBlockchain.getUTXOsForAddress(currentWallet.getAddress())
    });
});

// Créer une transaction
app.post("/api/transaction", (req, res) => {
    if (!currentWallet) {
        return res.status(400).json({ error: "Aucun wallet sélectionné" });
    }
    const { toAddress, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Montant invalide" });
    }

    const myAddress = currentWallet.getAddress();
    const utxos = myBlockchain.getUTXOsForAddress(myAddress);
    let selected = [];
    let total = 0;
    for (const utxo of utxos) {
        selected.push(utxo);
        total += utxo.amount;
        if (total >= parsedAmount) break;
    }
    if (total < parsedAmount) {
        return res.status(400).json({ error: "Solde insuffisant" });
    }

    const tx = new Transaction();
    selected.forEach(utxo => {
        tx.addInput(utxo.txid, utxo.outputIndex, currentWallet.publicKey);
    });
    tx.addOutput(toAddress, parsedAmount);
    const change = total - parsedAmount;
    if (change > 0) {
        tx.addOutput(myAddress, change);
    }

    try {
        selected.forEach((_, idx) => {
            currentWallet.signTransaction(tx, idx);
        });
        if (tx.isValid(myBlockchain.utxoSet)) {
            myBlockchain.pendingTransactions.push(tx);
            io.emit("pending_transactions", myBlockchain.pendingTransactions.length);
            res.json({ success: true, txid: tx.calculateHash() });
        } else {
            res.status(400).json({ error: "Transaction invalide" });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Miner un bloc
app.post("/api/mine", (req, res) => {
    if (!currentWallet) {
        return res.status(400).json({ error: "Aucun wallet sélectionné pour recevoir la récompense" });
    }
    try {
        myBlockchain.minePendingTransaction(currentWallet.getAddress());
        saveChain(myBlockchain);
        io.emit("blockchain_update", {
            chainLength: myBlockchain.chain.length,
            latestBlock: myBlockchain.getLatestBlock()
        });
        io.emit("pending_transactions", myBlockchain.pendingTransactions.length);
        res.json({ success: true, blockIndex: myBlockchain.chain.length - 1 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Récupérer toute la blockchain
app.get("/api/chain", (req, res) => {
    res.json(myBlockchain.chain);
});

// Récupérer les transactions en attente
app.get("/api/pending", (req, res) => {
    res.json(myBlockchain.pendingTransactions);
});

// Connexion à un pair
app.post("/api/peer", (req, res) => {
    const { address } = req.body;
    p2p.connectToPeer(address);
    res.json({ success: true });
});

// ─── Socket.IO : mise à jour en temps réel ────────────────────────────────
io.on("connection", (socket) => {
    console.log("Client web connecté");
    socket.emit("blockchain_update", {
        chainLength: myBlockchain.chain.length,
        latestBlock: myBlockchain.getLatestBlock()
    });
    socket.emit("pending_transactions", myBlockchain.pendingTransactions.length);
});

// Démarrer le serveur HTTP
server.listen(HTTP_PORT, () => {
    console.log(`Serveur web + API sur http://localhost:${HTTP_PORT}`);
});