const socket = io();

// Éléments DOM
const blockCountSpan = document.getElementById("block-count");
const txPendingSpan = document.getElementById("tx-pending");
const walletSelect = document.getElementById("wallet-select");
const walletInfoDiv = document.getElementById("wallet-info");
const walletNotSelectedDiv = document.getElementById("wallet-not-selected");
const currentWalletName = document.getElementById("current-wallet-name");
const currentWalletAddress = document.getElementById("current-wallet-address");
const currentWalletBalance = document.getElementById("current-wallet-balance");

// Récupérer le port P2P depuis l'URL ou une variable (à titre informatif)
fetch("/api/chain")
    .then(() => {})
    .catch(console.error);

// Socket events
socket.on("blockchain_update", (data) => {
    blockCountSpan.textContent = data.chainLength;
    if (currentWalletAddress.textContent) {
        refreshBalance();
    }
});

socket.on("pending_transactions", (count) => {
    txPendingSpan.textContent = count;
});

// Charger la liste des wallets au démarrage
async function loadWallets() {
    const res = await fetch("/api/wallets");
    const wallets = await res.json();
    walletSelect.innerHTML = "";
    wallets.forEach(name => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        walletSelect.appendChild(option);
    });
}

// Créer un wallet
document.getElementById("create-wallet-btn").addEventListener("click", async () => {
    const name = prompt("Nom du nouveau wallet:");
    if (!name) return;
    const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    if (res.ok) {
        const data = await res.json();
        alert(`Wallet "${name}" créé.\nAdresse: ${data.address}`);
        loadWallets();
    } else {
        const err = await res.json();
        alert("Erreur: " + err.error);
    }
});

// Sélectionner un wallet
document.getElementById("select-wallet-btn").addEventListener("click", async () => {
    const name = walletSelect.value;
    if (!name) return;
    const res = await fetch("/api/wallet/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
    });
    if (res.ok) {
        const data = await res.json();
        currentWalletName.textContent = name;
        currentWalletAddress.textContent = data.address;
        currentWalletBalance.textContent = data.balance;
        walletInfoDiv.style.display = "block";
        walletNotSelectedDiv.style.display = "none";
    } else {
        alert("Erreur lors de la sélection");
    }
});

// Rafraîchir le solde
async function refreshBalance() {
    const res = await fetch("/api/wallet/current");
    const data = await res.json();
    if (data) {
        currentWalletBalance.textContent = data.balance;
    }
}
document.getElementById("refresh-balance").addEventListener("click", refreshBalance);

// Envoyer une transaction
document.getElementById("send-btn").addEventListener("click", async () => {
    const toAddress = document.getElementById("send-to-address").value.trim();
    const amount = document.getElementById("send-amount").value;
    if (!toAddress || !amount) return alert("Adresse et montant requis");
    
    const res = await fetch("/api/transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toAddress, amount })
    });
    const result = await res.json();
    const resultDiv = document.getElementById("send-result");
    if (res.ok) {
        resultDiv.innerHTML = `✅ Transaction créée ! TXID: ${result.txid.substring(0, 20)}...`;
        refreshBalance();
    } else {
        resultDiv.innerHTML = `❌ Erreur: ${result.error}`;
    }
});

// Miner
document.getElementById("mine-btn").addEventListener("click", async () => {
    const res = await fetch("/api/mine", { method: "POST" });
    const result = await res.json();
    if (res.ok) {
        alert(`Bloc miné ! Index: ${result.blockIndex}`);
        refreshBalance();
    } else {
        alert("Erreur: " + result.error);
    }
});

// Connecter un pair
document.getElementById("connect-peer-btn").addEventListener("click", async () => {
    let address = document.getElementById("peer-address").value.trim();
    if (/^\d+$/.test(address)) address = `ws://localhost:${address}`;
    const res = await fetch("/api/peer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address })
    });
    if (res.ok) alert("Connexion au pair initiée");
    else alert("Erreur de connexion");
});

// Afficher la chaîne
document.getElementById("refresh-chain").addEventListener("click", async () => {
    const res = await fetch("/api/chain");
    const chain = await res.json();
    const view = document.getElementById("chain-view");
    view.innerHTML = chain.map(block => `
        <div class="block">
            <strong>Bloc #${block.index}</strong><br>
            Hash: ${block.hash.substring(0, 20)}...<br>
            Prev: ${block.previousHash.substring(0, 20)}...<br>
            Transactions: ${block.transactions.length}
        </div>
    `).join("");
});

// Afficher les UTXOs
document.getElementById("refresh-utxos").addEventListener("click", async () => {
    const res = await fetch("/api/wallet/current");
    const data = await res.json();
    const view = document.getElementById("utxo-view");
    if (!data || !data.utxos) {
        view.innerHTML = "Aucun wallet sélectionné";
        return;
    }
    view.innerHTML = data.utxos.map(utxo => `
        <div>TXID: ${utxo.txid.substring(0, 15)}... | Index: ${utxo.outputIndex} | Montant: ${utxo.amount}</div>
    `).join("");
});

// Initialisation
loadWallets();
refreshChain(); // appel initial