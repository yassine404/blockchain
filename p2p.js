const WebSocket = require("ws");
const Block       = require("./block");
const Transaction = require("./transaction");

// Types de messages échangés entre nœuds
const MSG = {
    QUERY_ALL:       "QUERY_ALL",
    RESPONSE_ALL:    "RESPONSE_ALL",
    NEW_BLOCK:       "NEW_BLOCK",
    NEW_TRANSACTION: "NEW_TRANSACTION"   // Optionnel – pour partager le mempool
};

class P2P {
    constructor(blockchain) {
        this.blockchain = blockchain;
        this.sockets    = [];
        this.port       = null;
        // Callback appelé après adoption d'une nouvelle chaîne (pour sauvegarder)
        this.onChainUpdate = null;
    }

    // ─── Serveur ────────────────────────────────────────────────────────────────
    listen(port) {
        const server = new WebSocket.Server({ port });

        server.on("error", err => {
            if (err.code === "EADDRINUSE") {
                console.warn(`Port ${port} occupé, essai sur ${port + 1}...`);
                server.close();
                this.listen(port + 1);
            } else {
                console.error("Erreur P2P serveur:", err.message);
            }
        });

        server.on("listening", () => {
            console.log(`Serveur P2P sur port ${port}`);
            this.port = port;
            server.on("connection", socket => {
                console.log(`Nouveau pair connecté sur port ${port}`);
                this.initConnection(socket);
            });
        });
    }

    // ─── Client ─────────────────────────────────────────────────────────────────
    connectToPeer(peerAddress) {
        const socket = new WebSocket(peerAddress);

        socket.on("open", () => {
            console.log(`Connecté au pair : ${peerAddress}`);
            this.initConnection(socket);
            // Dès la connexion, demander toute la chaîne du pair
            this.send(socket, { type: MSG.QUERY_ALL });
        });

        socket.on("error", err => {
            console.warn(`Impossible de joindre ${peerAddress}: ${err.message}`);
        });
    }

    // ─── Initialisation d'une connexion (commune client/serveur) ────────────────
    initConnection(socket) {
        this.sockets.push(socket);

        socket.on("message", data => {
            try {
                const msg = JSON.parse(data);
                this.handleMessage(socket, msg);
            } catch (e) {
                console.error("Message P2P invalide:", e.message);
            }
        });

        socket.on("close", () => {
            this.sockets = this.sockets.filter(s => s !== socket);
            console.log("Pair déconnecté.");
        });

        socket.on("error", err => {
            console.warn("Erreur socket pair:", err.message);
        });
    }

    // ─── Traitement des messages reçus ──────────────────────────────────────────
    handleMessage(socket, msg) {
        switch (msg.type) {

            case MSG.QUERY_ALL:
                this.send(socket, {
                    type:  MSG.RESPONSE_ALL,
                    chain: this.blockchain.chain,
                });
                break;

            case MSG.RESPONSE_ALL:
                this.handleChainResponse(msg.chain);
                break;

            case MSG.NEW_BLOCK:
                this.handleNewBlock(msg.block);
                break;

            // Optionnel – réception d'une transaction diffusée
            case MSG.NEW_TRANSACTION:
                this.handleNewTransaction(msg.transaction);
                break;

            default:
                console.warn("Message P2P inconnu:", msg.type);
        }
    }

    // ─── Réception d'une chaîne complète ────────────────────────────────────────
    handleChainResponse(rawChain) {
        // Re-hydrater : objets JSON → vraies instances Block + Transaction
        const receivedChain = rawChain.map(b => {
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

        const ourLength      = this.blockchain.chain.length;
        const receivedLength = receivedChain.length;

        if (receivedLength <= ourLength) {
            console.log(`Chaîne reçue (${receivedLength} blocs) <= notre chaîne (${ourLength} blocs) — ignorée`);
            return;
        }

        if (!this.isValidChain(receivedChain)) {
            console.warn("Chaîne reçue invalide — ignorée");
            return;
        }

        console.log(`Chaîne plus longue adoptée : ${receivedLength} blocs (on avait ${ourLength})`);
        this.blockchain.chain = receivedChain;

        // ⚡ RECONSTRUIRE L'UTXO SET À PARTIR DE LA NOUVELLE CHAÎNE
        this.blockchain._buildUTXOset();

        if (this.onChainUpdate) this.onChainUpdate();
    }

    // ─── Réception d'un nouveau bloc miné par un pair ───────────────────────────
    handleNewBlock(rawBlock) {
        // Re-hydrater le bloc
        const block = Object.assign(new Block(0, 0, [], ""), rawBlock);
        if (Array.isArray(block.transactions)) {
            block.transactions = block.transactions.map(t => {
                const tx = new Transaction();
                Object.assign(tx, t);
                return tx;
            });
        }

        const latest = this.blockchain.getLatestBlock();

        if (block.index !== latest.index + 1) {
            console.warn(`Bloc #${block.index} inattendu (on attend #${latest.index + 1}) — on demande la chaîne complète`);
            this.broadcastAll({ type: MSG.QUERY_ALL });
            return;
        }

        if (block.previousHash !== latest.hash) {
            console.warn(`Bloc #${block.index} : previousHash incorrect — ignoré`);
            return;
        }

        const tempBlock = Object.assign(new Block(0, 0, [], ""), block);
        if (tempBlock.calculateHash() !== block.hash) {
            console.warn(`Bloc #${block.index} : hash invalide — ignoré`);
            return;
        }

        // ⚡ APPLIQUER LES TRANSACTIONS À L'UTXO SET AVANT D'AJOUTER LE BLOC
        block.transactions.forEach(tx => this.blockchain._applyTransactionToUTXOSet(tx));

        this.blockchain.chain.push(block);
        console.log(`Bloc #${block.index} reçu et ajouté depuis un pair`);

        if (this.onChainUpdate) this.onChainUpdate();
    }

    // ─── Réception d'une transaction diffusée (optionnel) ───────────────────────
    handleNewTransaction(rawTx) {
        const tx = new Transaction();
        Object.assign(tx, rawTx);
        if (tx.isValid(this.blockchain.utxoSet)) {
            // Éviter les doublons
            const exists = this.blockchain.pendingTransactions.some(
                t => t.calculateHash() === tx.calculateHash()
            );
            if (!exists) {
                this.blockchain.pendingTransactions.push(tx);
                console.log("Nouvelle transaction reçue et ajoutée au mempool");
            }
        } else {
            console.warn("Transaction reçue invalide — ignorée");
        }
    }

    // ─── Diffuser un nouveau bloc miné à tous les pairs ─────────────────────────
    broadcast(block) {
        const msg = JSON.stringify({ type: MSG.NEW_BLOCK, block });
        let count = 0;
        this.sockets.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(msg);
                count++;
            }
        });
        if (count > 0) console.log(`Bloc #${block.index} diffusé à ${count} pair(s)`);
    }

    // ─── Diffuser une transaction à tous les pairs (optionnel) ──────────────────
    broadcastTransaction(tx) {
        this.broadcastAll({ type: MSG.NEW_TRANSACTION, transaction: tx });
    }

    // ─── Diffuser un message quelconque à tous les pairs ────────────────────────
    broadcastAll(msgObj) {
        const raw = JSON.stringify(msgObj);
        this.sockets.forEach(socket => {
            if (socket.readyState === WebSocket.OPEN) socket.send(raw);
        });
    }

    // ─── Envoyer un message à un seul socket ────────────────────────────────────
    send(socket, msgObj) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(msgObj));
        }
    }

    // ─── Validation d'une chaîne reçue ──────────────────────────────────────────
    isValidChain(chain) {
        for (let i = 1; i < chain.length; i++) {
            const current  = chain[i];
            const previous = chain[i - 1];

            const temp = Object.assign(new Block(0, 0, [], ""), current);
            if (temp.calculateHash() !== current.hash) {
                console.error(`Bloc #${i} hash invalide`);
                return false;
            }

            if (current.previousHash !== previous.hash) {
                console.error(`Bloc #${i} non lié au bloc #${i - 1}`);
                return false;
            }
        }
        return true;
    }
}

module.exports = P2P;