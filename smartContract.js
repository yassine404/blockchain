class SmartContract {
    constructor(condition, action) {
        this.condition = condition;
        this.action = action;
    }

    execute(blockchain) {
        if (this.condition(blockchain)) {
            console.log("smart contract condition met -executing action ...")
            this.action(blockchain);
        } else {
            console.log("📜 Smart contract condition not met — no action taken");
        }
        }
    }
module.exports = SmartContract;