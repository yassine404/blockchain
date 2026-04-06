/**
 * test.js
 * =======
 * Fichier de test complet pour la blockchain
 * Teste : Wallets, Transactions signées, Mining, Récompenses, Validation de chaîne
 *
 * Pour lancer : node test.js
 * Dépendances  : npm install crypto-js elliptic
 */

const Blockchain  = require("./blockchain");
const Transaction = require("./transaction");
const Wallet      = require("./wallet");
const SmartContract = require("./smartContract");

// ─── Couleurs console ────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN   = "\x1b[36m";
const RESET  = "\x1b[0m";
const BOLD   = "\x1b[1m";

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`${GREEN}✅ PASS${RESET} — ${description}`);
        passed++;
    } catch (err) {
        console.log(`${RED}❌ FAIL${RESET} — ${description}`);
        console.log(`        ${RED}${err.message}${RESET}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
}

function section(title) {
    console.log(`\n${BOLD}${CYAN}${"─".repeat(55)}${RESET}`);
    console.log(`${BOLD}${CYAN}  ${title}${RESET}`);
    console.log(`${BOLD}${CYAN}${"─".repeat(55)}${RESET}`);
}

// ─── SETUP ───────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}🔗 Blockchain Test Suite${RESET}\n`);

// ─────────────────────────────────────────────────────────────────────────────
section("1. WALLETS — Génération de clés");
// ─────────────────────────────────────────────────────────────────────────────

const alice = new Wallet();
const bob   = new Wallet();
const miner = new Wallet();

test("Alice a une adresse publique (clé publique)", () => {
    assert(alice.getAddress().length > 0, "L'adresse est vide");
});

test("Deux wallets ont des adresses différentes", () => {
    assert(alice.getAddress() !== bob.getAddress(), "Les adresses sont identiques !");
});

test("L'adresse est une chaîne hexadécimale valide", () => {
    assert(/^[0-9a-fA-F]+$/.test(alice.getAddress()), "L'adresse n'est pas en hex");
});

// ─────────────────────────────────────────────────────────────────────────────
section("2. TRANSACTIONS — Création & Signature (Request 4)");
// ─────────────────────────────────────────────────────────────────────────────

test("Créer une transaction valide et la signer", () => {
    const tx = new Transaction(alice.getAddress(), bob.getAddress(), 50);
    alice.signTransaction(tx);
    assert(tx.signature !== null, "La signature est nulle");
    assert(tx.signature.length > 0, "La signature est vide");
});

test("isValid() retourne true pour une transaction bien signée", () => {
    const tx = new Transaction(alice.getAddress(), bob.getAddress(), 50);
    alice.signTransaction(tx);
    assert(tx.isValid() === true, "Transaction valide rejetée");
});

test("isValid() lève une erreur si aucune signature", () => {
    const tx = new Transaction(alice.getAddress(), bob.getAddress(), 50);
    let threw = false;
    try { tx.isValid(); } catch (e) { threw = true; }
    assert(threw, "Aurait dû lancer une erreur (pas de signature)");
});

test("On ne peut pas signer avec la mauvaise clé (wallet de Bob pour tx d'Alice)", () => {
    const tx = new Transaction(alice.getAddress(), bob.getAddress(), 50);
    let threw = false;
    try { bob.signTransaction(tx); } catch (e) { threw = true; }
    assert(threw, "Aurait dû lancer une erreur (mauvaise clé)");
});

test("Une transaction de récompense minière (fromAddress=null) est toujours valide", () => {
    const rewardTx = new Transaction(null, miner.getAddress(), 50);
    assert(rewardTx.isValid() === true, "La récompense minière devrait être valide");
});

test("calculateHash() change si le montant est modifié", () => {
    const tx = new Transaction(alice.getAddress(), bob.getAddress(), 50);
    const hash1 = tx.calculateHash();
    tx.amount = 9999; // Tentative de falsification
    const hash2 = tx.calculateHash();
    assert(hash1 !== hash2, "Le hash devrait changer après modification du montant");
});

// ─────────────────────────────────────────────────────────────────────────────
section("3. BLOCKCHAIN — Initialisation");
// ─────────────────────────────────────────────────────────────────────────────

const chain = new Blockchain();

test("La blockchain contient un bloc Genesis", () => {
    assert(chain.chain.length === 1, "Devrait avoir exactement 1 bloc");
});

test("Le bloc Genesis a le previousHash '0'", () => {
    assert(chain.chain[0].previousHash === "0", "previousHash du genesis devrait être '0'");
});

test("La chaîne est valide dès le départ", () => {
    assert(chain.isChainValid() === true, "La chaîne devrait être valide");
});

// ─────────────────────────────────────────────────────────────────────────────
section("4. MINING — Récompenses (Request 3)");
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${YELLOW}⏳ Mining en cours (difficulté 4)... patience !${RESET}`);

test("Miner un bloc ajoute un bloc à la chaîne", () => {
    const before = chain.chain.length;
    chain.minePendingTransactions(miner.getAddress());
    assert(chain.chain.length === before + 1, "Le bloc n'a pas été ajouté");
});

test("Le mineur reçoit sa récompense après le minage", () => {
    // Mine à nouveau pour débloquer la récompense du bloc précédent
    chain.minePendingTransactions(miner.getAddress());
    const balance = chain.getBalanceOfAddress(miner.getAddress());
    assert(balance > 0, `La balance du mineur devrait être > 0, got ${balance}`);
});

test("La récompense minière est correcte (50 coins par bloc)", () => {
    const balance = chain.getBalanceOfAddress(miner.getAddress());
    // 2 blocs minés → récompense reçue dans le 2e (la récompense du bloc N est dans le bloc N+1)
    assert(balance === 50, `Attendu 50, obtenu ${balance}`);
});

// ─────────────────────────────────────────────────────────────────────────────
section("5. TRANSACTIONS SUR LA CHAÎNE — Flux complet");
// ─────────────────────────────────────────────────────────────────────────────

// D'abord, on donne des coins au mineur pour qu'il puisse envoyer
// On mine plusieurs fois pour qu'il ait des fonds
chain.minePendingTransactions(miner.getAddress());
chain.minePendingTransactions(miner.getAddress());

// Maintenant le mineur a 50 coins confirmés, il peut envoyer à Alice
const tx1 = new Transaction(miner.getAddress(), alice.getAddress(), 30);
miner.signTransaction(tx1);
chain.createTransaction(tx1);
chain.minePendingTransactions(miner.getAddress()); // mine ce bloc + récompense pour lui

test("Alice reçoit 30 coins envoyés par le mineur", () => {
    const aliceBalance = chain.getBalanceOfAddress(alice.getAddress());
    assert(aliceBalance === 30, `Alice devrait avoir 30, got ${aliceBalance}`);
});

// Alice envoie 10 à Bob
const tx2 = new Transaction(alice.getAddress(), bob.getAddress(), 10);
alice.signTransaction(tx2);
chain.createTransaction(tx2);
chain.minePendingTransactions(miner.getAddress());

test("Alice a 20 coins après avoir envoyé 10 à Bob", () => {
    const aliceBalance = chain.getBalanceOfAddress(alice.getAddress());
    assert(aliceBalance === 20, `Alice devrait avoir 20, got ${aliceBalance}`);
});

test("Bob a 10 coins reçus d'Alice", () => {
    const bobBalance = chain.getBalanceOfAddress(bob.getAddress());
    assert(bobBalance === 10, `Bob devrait avoir 10, got ${bobBalance}`);
});

test("La chaîne reste valide après plusieurs transactions", () => {
    assert(chain.isChainValid() === true, "La chaîne devrait être valide");
});

// ─────────────────────────────────────────────────────────────────────────────
section("6. SÉCURITÉ — Tentatives de falsification");
// ─────────────────────────────────────────────────────────────────────────────

test("Ajouter une transaction non signée est refusé", () => {
    const fakeTx = new Transaction(alice.getAddress(), bob.getAddress(), 9999);
    // Pas de signature !
    let threw = false;
    try { chain.createTransaction(fakeTx); } catch (e) { threw = true; }
    assert(threw, "Aurait dû rejeter la transaction non signée");
});

test("Modifier un bloc invalide la chaîne", () => {
    // Tamper with block data
    chain.chain[1].transactions = [{ fromAddress: null, toAddress: bob.getAddress(), amount: 99999 }];
    assert(chain.isChainValid() === false, "La chaîne aurait dû être invalidée");
});

// ─────────────────────────────────────────────────────────────────────────────
section("7. SMART CONTRACT");
// ─────────────────────────────────────────────────────────────────────────────

const freshChain = new Blockchain();
freshChain.minePendingTransactions(miner.getAddress());
freshChain.minePendingTransactions(miner.getAddress()); // miner a 50 coins

let contractFired = false;

const contract = new SmartContract(
    // Condition : le mineur a plus de 40 coins
    (bc) => bc.getBalanceOfAddress(miner.getAddress()) > 40,

    // Action : déclenche un flag pour le test
    (bc) => { contractFired = true; }
);

test("Le smart contract se déclenche quand la condition est vraie", () => {
    contract.execute(freshChain);
    assert(contractFired === true, "Le contrat aurait dû se déclencher");
});

test("Le smart contract ne se déclenche pas si la condition est fausse", () => {
    let fired = false;
    const contract2 = new SmartContract(
        (bc) => bc.getBalanceOfAddress(alice.getAddress()) > 999999, // impossible
        (bc) => { fired = true; }
    );
    contract2.execute(freshChain);
    assert(fired === false, "Le contrat ne devrait pas se déclencher");
});

// ─────────────────────────────────────────────────────────────────────────────
section("8. RÉSUMÉ");
// ─────────────────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n  Tests passés  : ${GREEN}${passed} / ${total}${RESET}`);
if (failed > 0) {
    console.log(`  Tests échoués : ${RED}${failed} / ${total}${RESET}`);
} else {
    console.log(`  ${GREEN}${BOLD}🎉 Tous les tests sont passés !${RESET}`);
}
console.log();