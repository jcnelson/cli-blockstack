/* @flow */

const blockstack = require('blockstack')
const keychains = require('blockstack-keychains')
const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')

// for portal versions before 2038088458012dcff251027ea23a22afce443f3b
class IdentityNode{
  key : Object
  constructor(key: Object) {
    this.key = key;
  }
  getAddress() : string {
    return this.key.keyPair.getAddress();
  }
  getSKHex() : string {
    return this.key.keyPair.d.toBuffer(32).toString('hex');
  }
}

const VERSIONS = {
  "pre-v0.9" : (m, i) => { return getIdentityKeyPre09(m) },
  "v0.9-v0.10" : (m, i) => { return getIdentityKey09to10(getMaster(m), i) },
  "v0.10-current" : (m, i) => { return getIdentityKeyCurrent(getMaster(m), i) },
  "current-btc" : (m, i) => { return getBTC(getMaster(m)) },
}

function getBTC(pK : Object) {
  const BIP_44_PURPOSE = 44;
  const BITCOIN_COIN_TYPE = 0;
  const ACCOUNT_INDEX = 0;

  return pK.deriveHardened(BIP_44_PURPOSE)
     .deriveHardened(BITCOIN_COIN_TYPE)
     .deriveHardened(ACCOUNT_INDEX).derive(0).derive(0);
}

function getIdentityNodeFromPhrase(phrase : string, 
                                   index : number,
                                   version : string = "current"){
  if (! (version in VERSIONS)){
    throw new Error(`Key derivation version '${version}' not uspported`);
  }
  return VERSIONS[version](phrase, index);
}

function getIdentityKeyCurrent(pK : Object, index : number = 0){
  return new IdentityNode(
    pK.deriveHardened(888).deriveHardened(0).deriveHardened(index));
}

function getIdentityKey09to10(pK : Object, index : number = 0){
  return new IdentityNode(
     pK.deriveHardened(888).deriveHardened(0).deriveHardened(index).derive(0));
}

function toAddress(k : Object) : string {
  return k.key.keyPair.getAddress();
}

function toPrivkeyHex(k : Object) : string {
  return k.key.keyPair.d.toHex() + '01';
}

function getIdentityKeyPre09(mnemonic : string) : IdentityNode {
  // on browser branch, v09 was commit -- 848d1f5445f01db1e28cde4a52bb3f22e5ca014c
  const pK = keychains.PrivateKeychain.fromMnemonic(mnemonic);
  const identityKey = pK.privatelyNamedChild('blockstack-0');
  const secret = identityKey.ecPair.d;
  const keyPair = new bitcoin.ECPair(secret, false, {"network" :
                                                    bitcoin.networks.bitcoin});
  return new IdentityNode({ keyPair });
}

function getMaster(mnemonic : string) {
  const seed = bip39.mnemonicToSeed(mnemonic);
  return bitcoin.HDNode.fromSeedBuffer(seed);
}

/*
 * Get the owner key information for a 12-word phrase, at a specific index.
 * @mnemonic (string) the 12-word phrase
 * @index (number) the account index
 * @version (string) the derivation version string
 *
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .version (string) the version string of the derivation
 *    .idAddress (string) the ID-address
 */
export function getOwnerKeyInfo(mnemonic : string, 
                                index : number, 
                                version : string = 'v0.10-current') {
  const network = blockstack.config.network;
  const identity = getIdentityNodeFromPhrase(mnemonic, index, version);
  const addr = network.coerceAddress(toAddress(identity));
  const privkey = toPrivkeyHex(identity);
  return {
    privateKey: privkey,
    version: version,
    index: index,
    idAddress: `ID-${addr}`,
  };
}

/*
 * Get the payment key information for a 12-word phrase.
 * @mnemonic (string) the 12-word phrase
 * 
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .address (string) the address of the private key
 */
export function getPaymentKeyInfo(mnemonic : string) {
  const network = blockstack.config.network;
  const identity = getIdentityNodeFromPhrase(mnemonic, 0, 'current-btc');
  const addr = network.coerceAddress(identity.keyPair.getAddress());
  const privkey = identity.keyPair.d.toHex() + '01';
  return {
    privateKey: privkey,
    address: addr,
    index: 0
  };
}

