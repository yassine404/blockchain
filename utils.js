// utils.js
const SHA256 = require("crypto-js/sha256");
const RIPEMD160 = require("crypto-js/ripemd160");

function publicKeyToAddress(pubKeyHex) {
    const sha = SHA256(pubKeyHex).toString();
    const ripe = RIPEMD160(sha).toString();
    // Add version byte (0x00 for mainnet) and checksum
    const versioned = "00" + ripe;
    const checksum = SHA256(SHA256(versioned)).toString().substring(0, 8);
    return versioned + checksum;   // Hex string, later encode in Base58
}
module.exports = {publicKeyToAddress};