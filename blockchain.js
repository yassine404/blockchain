const Block =require("./block");
const Transaction = require("./transaction");


class Blockchain {
    constructor(){
        this.chain = [this.createGenesisBlock()];
        this.difficulty = 4;
        this.pendingTransactions = [];
        this.miningReward = 50 ;
        this.utxoSet ={};
        this._buildUTXOset();
    }

    _buildUTXOset() {
        this.utxoSet = {};
        for (const block of this.chain){
            for(const tx of block.transactions) {
                this._applyTransactionToUTXOSet(tx);
            }
        }
    }

    _applyTransactionToUTXOSet(tx) {
        for (const inp of tx.inputs) {
            if (this.utxoSet[inp.txid] && this.utxoSet[inp.txid][inp.outputIndex]) {
                this.utxoSet[inp.txid][inp.outputIndex].spent = true;
            }
        }
        // Add new outputs
        const txid = tx.calculateHash(); // or use a unique ID
        if (!this.utxoSet[txid]) this.utxoSet[txid] = {};
        tx.outputs.forEach((out, idx) => {
            this.utxoSet[txid][idx] = {
                address: out.address,
                amount: out.amount,
                spent: false
            };
        });
    }

    createGenesisBlock(){
        return new Block(0,Date.now(),[], "0");
    }

    getLatestBlock(){
        return this.chain[this.chain.length - 1];
    }


    minePendingTransaction(minerAddress) {
        console.log("\nMining...");
        // Create coinbase transaction (no inputs, one output to miner)
        const coinbase = new Transaction();
        coinbase.addOutput(minerAddress, this.miningReward);
        // Collect valid pending transactions (validate against current UTXO set)
        const validTxs = [];
        for (const tx of this.pendingTransactions) {
            if (tx.isValid(this.utxoSet)) {
                validTxs.push(tx);
            } else {
                console.warn("Invalid pending transaction removed");
            }
        }
        const blockTransactions = [coinbase, ...validTxs];
        const block = new Block(
            this.chain.length,
            Date.now(),
            blockTransactions,
            this.getLatestBlock().hash
        );
        block.mineBlock(this.difficulty);
        // Apply transactions to UTXO set BEFORE pushing block
        block.transactions.forEach(tx => this._applyTransactionToUTXOSet(tx));
        this.chain.push(block);
        if (this.p2p) this.p2p.broadcast(block);
        this.pendingTransactions = [];
    }
    

    getBalanceOfAddress(address) {
        let balance = 0;
        for (const txid in this.utxoSet) {
            for (const outIdx in this.utxoSet[txid]) {
                const utxo = this.utxoSet[txid][outIdx];
                if (!utxo.spent && utxo.address === address) {
                    balance += utxo.amount;
                }
            }
        }
        return balance;
    }

    // Find UTXOs for a given address (used to build new transaction)
    getUTXOsForAddress(address) {
        const utxos = [];
        for (const txid in this.utxoSet) {
            for (const outIdx in this.utxoSet[txid]) {
                const utxo = this.utxoSet[txid][outIdx];
                if (!utxo.spent && utxo.address === address) {
                    utxos.push({ txid, outputIndex: parseInt(outIdx), amount: utxo.amount });
                }
            }
        }
        return utxos;
    }

    isChainValid() {
    // Rebuild UTXO set incrementally to validate each block in its historical context
    const tempUTXO = {};
    for (let i = 0; i < this.chain.length; i++) {
        const block = this.chain[i];
        // Check block hash and link (skip genesis)
        if (i > 0) {
            const prevBlock = this.chain[i - 1];
            if (block.previousHash !== prevBlock.hash) return false;
            if (block.hash !== block.calculateHash()) return false;
        }
        // Validate all transactions in the block using current tempUTXO
        for (const tx of block.transactions) {
            if (!tx.isValid(tempUTXO)) {
                console.error(`Invalid transaction in block ${i}`);
                return false;
            }
            // Apply transaction to tempUTXO (mark inputs spent, add outputs)
            // (same logic as _applyTransactionToUTXOSet but on tempUTXO)
            for (const inp of tx.inputs) {
                if (tempUTXO[inp.txid]?.[inp.outputIndex]) {
                    tempUTXO[inp.txid][inp.outputIndex].spent = true;
                }
            }
            const txid = tx.calculateHash();
            if (!tempUTXO[txid]) tempUTXO[txid] = {};
            tx.outputs.forEach((out, idx) => {
                tempUTXO[txid][idx] = { address: out.address, amount: out.amount, spent: false };
            });
        }
    }
    return true;
}
}

module.exports = Blockchain;