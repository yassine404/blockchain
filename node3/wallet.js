const EC = require("elliptic").ec;
const ec = new EC("secp256k1");

class Wallet {
    constructor() {
        this.keyPair = ec.genKeyPair();
        this.publicKey = this.keyPair.getPublic("hex");
    }

    getAddress() {
        return this.publicKey;
    }

    signTransaction(transaction) {
        transaction.signTransaction(this.keyPair);
    }

    
}

module.exports = Wallet;