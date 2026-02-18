class block{

    constructor(index, timetamp, data, previousHash=''){
        this.index=index;
        this.previousHash=previousHash;
        this.timetamp=timetamp;
        this.data=data;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        return crypto.SHA256(this.index + this.previousHash + this.timetamp + JSON.stringify(this.data)).toString();
    }
}