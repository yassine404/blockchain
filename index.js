const express = require('express');
const crypto = require("crypto-js");
const {Web3} = require('web3');

const web3 = new Web3("http://localhost:8545");

const app = express();

const PORT = 3000;
app.listen(PORT,()=> {
    console.log(`Server running on port ${PORT}`);
} )