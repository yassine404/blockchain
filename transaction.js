const SHA256 = require("crypto-js/sha256");
const EC = require("elliptic").ec;
const ec = new EC("secp256k1");
const { publicKeyToAddress } = require("./utils");


class Transaction {
    constructor(){
        this.inputs=[];// array of txid , outpoutindex , signature , pubkey
        this.outputs =[]; // aray of  address, amount
        this.timestamp   = Date.now();
    }

    addInput(txid, outputIndex, pubkey= null){
        this.inputs.push({txid, outputIndex, signature: null,pubkey});
    }

    addOutput(address ,amount){
        this.outputs.push({address, amount})
    }


    calculateHash() {
        const data ={
            inputs: this.inputs.map(i => ({
                txid: i.txid, 
                outputIndex: i.outputIndex,
                pubkey: i.pubkey
            })),outputs:this.outputs ,
            timestamp: this.timestamp 
        };
        return SHA256(JSON.stringify(data)).toString();
    }

    signInput(index, privateKey) {
        const key = ec.keyFromPrivate(privateKey,"hex");
        const pubkey = key.getPublic("hex");
        if(this.inputs[index].pubkey && this.inputs[index].pubkey !== pubkey){
            throw new Error("Private key does not match public key in input ")
        }
        this.inputs[index].pubkey = pubkey;
        const hash = this.calculateHash();
        const sig = key.sign(hash,"base64");
        this.inputs[index].signature =sig.toDER("hex");
    }
        
    isValid(utxoSet) {
        if (!this.inputs.length || !this.outputs.length) return false;

        let inputSum = 0 ;
        for(let i=0; i < this.inputs.length; i++){
            const inp =this.inputs[i];
            if(!inp.signature)return false;
            
            const utxo = utxoSet[inp.txid]?.[inp.outputIndex];
            if(!utxo)return false;
            if(utxo.spent) return false;

            const pubkeyObj = ec.keyFromPublic(inp.pubkey,"hex");
            if(!pubkeyObj.verify(this.calculateHash(), inp.signature)){
                return false;
            }
            // Inside isValid, after verifying signature:
            const expectedAddress = utxo.address;
            const actualAddress = publicKeyToAddress(inp.pubkey);
            if (expectedAddress !== actualAddress) return false;

            inputSum += utxo.amount;
        }
        const outputSum =this.outputs.reduce((sum, out) => sum + out.amount, 0);
        if (inputSum < outputSum) return false;
        return true;
    }
}

module.exports = Transaction;