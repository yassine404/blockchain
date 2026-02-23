const SHA256 = require("crypto-js/sha256")


class Block{

    constructor(index, timetamp, transactions, previousHash=''){
        this.index=index;
        this.previousHash=previousHash;
        this.timetamp=timetamp;
        this.transactions=transactions;
        this.nonce=0;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        return SHA256(this.index + this.previousHash + this.timetamp + JSON.stringify(this.transactions)+this.nonce).toString();
    }

    mineBlock(difficulty){
        while (this.hash.substring(0,difficulty) !== "0".repeat(difficulty)){
            this.nonce++;
            this.hash = this.calculateHash();
        }
        console.log("Block mined !");
        console.log ("block :" , this.index);
        console.log("Hash  :" , this.hash);
    }
}

module.exports = Block;

