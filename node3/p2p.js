const WebSocket = require("ws");
const Block       = require("./block");
const Transaction = require("./transaction");

// Types de messages échangés entre nœuds
const MSG = {
    QUERY_ALL:   "QUERY_ALL",    // "envoie-moi toute ta chaîne"
    RESPONSE_ALL: "RESPONSE_ALL", // "voici toute ma chaîne"
    NEW_BLOCK:   "NEW_BLOCK",    // "j'ai miné un nouveau bloc"
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
        this.port    = port;

        server.on("connection", socket => {
            console.log(`Nouveau pair connecte sur port ${port}`);
            this.initConnection(socket);
        });

        console.log(`Serveur P2P sur port ${port}`);
    }

    // ─── Client ─────────────────────────────────────────────────────────────────
    connectToPeer(peerAddress) {
        const socket = new WebSocket(peerAddress);

        socket.on("open", () => {
            console.log(`Connecte au pair : ${peerAddress}`);
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
            console.log("Pair deconnecte.");
        });

        socket.on("error", err => {
            console.warn("Erreur socket pair:", err.message);
        });
    }

    // ─── Traitement des messages reçus ──────────────────────────────────────────
    handleMessage(socket, msg) {
        switch (msg.type) {

            // Un pair demande toute notre chaîne → on lui envoie
            case MSG.QUERY_ALL:
                this.send(socket, {
                    type:  MSG.RESPONSE_ALL,
                    chain: this.blockchain.chain,
                });
                break;

            // Un pair nous envoie toute sa chaîne → on compare et on adopte si plus longue
            case MSG.RESPONSE_ALL:
                this.handleChainResponse(msg.chain);
                break;

            // Un pair a miné un nouveau bloc → on vérifie et on ajoute
            case MSG.NEW_BLOCK:
                this.handleNewBlock(msg.block);
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
                block.transactions = block.transactions.map(t =>
                    Object.assign(new Transaction(null, null, 0), t)
                );
            }
            return block;
        });

        const ourLength      = this.blockchain.chain.length;
        const receivedLength = receivedChain.length;

        if (receivedLength <= ourLength) {
            // Notre chaîne est aussi longue ou plus longue → on garde la nôtre
            console.log(`Chaine recue (${receivedLength} blocs) <= notre chaine (${ourLength} blocs) — ignoree`);
            return;
        }

        // La chaîne reçue est plus longue → on vérifie qu'elle est valide
        if (!this.isValidChain(receivedChain)) {
            console.warn("Chaine recue invalide — ignoree");
            return;
        }

        // On adopte la chaîne plus longue
        console.log(`Chaine plus longue adoptee : ${receivedLength} blocs (on avait ${ourLength})`);
        this.blockchain.chain = receivedChain;

        // Sauvegarder la nouvelle chaîne sur disque
        if (this.onChainUpdate) this.onChainUpdate();
    }

    // ─── Réception d'un nouveau bloc miné par un pair ───────────────────────────
    handleNewBlock(rawBlock) {
        // Re-hydrater le bloc
        const block = Object.assign(new Block(0, 0, [], ""), rawBlock);
        if (Array.isArray(block.transactions)) {
            block.transactions = block.transactions.map(t =>
                Object.assign(new Transaction(null, null, 0), t)
            );
        }

        const latest = this.blockchain.getLatestBlock();

        // Vérifications d'intégrité
        if (block.index !== latest.index + 1) {
            console.warn(`Bloc #${block.index} inattendu (on attend #${latest.index + 1}) — on demande la chaine complete`);
            // On est peut-être en retard de plusieurs blocs → demander toute la chaîne
            this.broadcastAll({ type: MSG.QUERY_ALL });
            return;
        }

        if (block.previousHash !== latest.hash) {
            console.warn(`Bloc #${block.index} : previousHash incorrect — ignore`);
            return;
        }

        // Vérifier le hash du bloc lui-même
        const tempBlock = Object.assign(new Block(0, 0, [], ""), block);
        if (tempBlock.calculateHash() !== block.hash) {
            console.warn(`Bloc #${block.index} : hash invalide — ignore`);
            return;
        }

        // Tout est bon : on ajoute le bloc
        this.blockchain.chain.push(block);
        console.log(`Bloc #${block.index} recu et ajoute depuis un pair`);

        // Sauvegarder
        if (this.onChainUpdate) this.onChainUpdate();
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
        if (count > 0) console.log(`Bloc #${block.index} diffuse a ${count} pair(s)`);
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

            // Vérifier le hash du bloc
            const temp = Object.assign(new Block(0, 0, [], ""), current);
            if (temp.calculateHash() !== current.hash) {
                console.error(`Bloc #${i} hash invalide`);
                return false;
            }

            // Vérifier le lien avec le bloc précédent
            if (current.previousHash !== previous.hash) {
                console.error(`Bloc #${i} non lie au bloc #${i - 1}`);
                return false;
            }
        }
        return true;
    }
}

module.exports = P2P;