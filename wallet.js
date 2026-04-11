const EC = require("elliptic").ec;
const ec = new EC("secp256k1");
const { publicKeyToAddress } = require("./utils");

class Wallet {
    constructor(privateKeyHex = null) {
        if (privateKeyHex) {
            this.keyPair = ec.keyFromPrivate(privateKeyHex, "hex");
        } else {
            this.keyPair = ec.genKeyPair();
        }
        this.publicKey = this.keyPair.getPublic("hex");
        this.address = publicKeyToAddress(this.publicKey);
    }

    getAddress() {
        return this.address;
    }

    getPrivateKey() {
        return this.keyPair.getPrivate("hex");
    }

    signTransaction(transaction, inputIndex) {
        // Sign a specific input of a UTXO transaction
        transaction.signInput(inputIndex, this.getPrivateKey());
    }
}

module.exports = Wallet;