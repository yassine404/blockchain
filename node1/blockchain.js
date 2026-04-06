const Block =require("./block");
const Transaction = require("./transaction");


class Blockchain {
    constructor(){
        this.chain = [this.createGenesisBlock()];
        this.difficulty = 4;
        this.pendingTransactions = [];
        this.miningReward = 50 ;
    }

    createGenesisBlock(){
        return new Block(0,Date.now(),"Genesis Block" , "0");
    }

    getLatestBlock(){
        return this.chain[this.chain.length - 1];
    }
    createTransaction(transaction) {
    if (!transaction.fromAddress || !transaction.toAddress) {
        throw new Error("Transaction must include from and to address");
    }

    if (!transaction.isValid()) {
        throw new Error("Cannot add invalid transaction");
    }

    
    const balance = this.getBalanceOfAddress(transaction.fromAddress);

    
    const pendingDebit = this.pendingTransactions
        .filter(tx => tx.fromAddress === transaction.fromAddress)
        .reduce((sum, tx) => sum + tx.amount, 0);

    const available = balance - pendingDebit;

    if (transaction.amount > available) {
        throw new Error(
            `Solde insuffisant : disponible ${available}, demande ${transaction.amount}`
        );
    }

    this.pendingTransactions.push(transaction);
}

    minePendingTransaction(minerAddress){
        
    


        console.log("\nMining...");

        const rewardTx = new Transaction(null,minerAddress,this.miningReward);
    
        const blockTransactions = [...this.pendingTransactions, rewardTx];
        const block =new Block(
            this.chain.length,
            Date.now(),
            blockTransactions,
            this.getLatestBlock().hash
        );
        block.mineBlock(this.difficulty);
        this.chain.push(block);

        if (this.p2p) {
        this.p2p.broadcast(block);
    }
        this.pendingTransactions = []
    
}
    

    getBalanceOfAddress(address) {

        let balance = 0;

        for (const block of this.chain) {
            for (const tx of block.transactions) {

                if (tx.fromAddress === address) {
                    balance -= tx.amount;
                }

                if (tx.toAddress === address) {
                    balance += tx.amount;
                }
            }
        }

        return balance;
    }

    isChainValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const current  = this.chain[i];
            const previous = this.chain[i - 1];

            // Check all transactions in this block are validly signed
            if (Array.isArray(current.transactions)) {
                for (const tx of current.transactions) {
                    if (!tx.isValid()) {
                        console.error(` Invalid transaction in block ${i}`);
                        return false;
                    }
                }
            }

            // Hash consistency: recalculate and compare
            if (current.hash !== current.calculateHash()) {
                console.error(` Block ${i} hash has been tampered with`);
                return false;
            }

            // Chain linkage: this block must point to the previous block's hash
            if (current.previousHash !== previous.hash) {
                console.error(` Block ${i} is not linked to block ${i - 1}`);
                return false;
            }
        }

        return true;
    }

}


module.exports = Blockchain;