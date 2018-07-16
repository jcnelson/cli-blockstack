/* @flow */

const blockstack = require('blockstack')
const keychains = require('blockstack-keychains')
const bitcoin = require('bitcoinjs-lib')
const bip39 = require('bip39')
const crypto = require('crypto')
const c32check = require('c32check')

import {
  getPrivateKeyAddress
} from './utils';

const IDENTITY_KEYCHAIN = 888
const BLOCKSTACK_ON_BITCOIN = 0
const APPS_NODE_INDEX = 0
const SIGNING_NODE_INDEX = 1
const ENCRYPTION_NODE_INDEX = 2

export const STRENGTH = 128;   // 12 words

class IdentityAddressOwnerNode {
  hdNode: Object
  salt: string

  constructor(ownerHdNode: Object, salt: string) {
    this.hdNode = ownerHdNode
    this.salt = salt
  }

  getNode() {
    return this.hdNode
  }

  getSalt() {
    return this.salt
  }

  getIdentityKey() {
    return this.hdNode.keyPair.d.toBuffer(32).toString('hex')
  }

  getIdentityKeyID() {
    return this.hdNode.keyPair.getPublicKeyBuffer().toString('hex')
  }

  getAppsNode() {
    return new AppsNode(this.hdNode.deriveHardened(APPS_NODE_INDEX), this.salt)
  }

  getAddress() {
    return this.hdNode.getAddress()
  }

  getEncryptionNode() {
    return this.hdNode.deriveHardened(ENCRYPTION_NODE_INDEX)
  }

  getSigningNode() {
    return this.hdNode.deriveHardened(SIGNING_NODE_INDEX)
  }
}

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
    pK.deriveHardened(IDENTITY_KEYCHAIN)
      .deriveHardened(BLOCKSTACK_ON_BITCOIN)
      .deriveHardened(index));
}

function getIdentityKey09to10(pK : Object, index : number = 0){
  return new IdentityNode(
     pK.deriveHardened(IDENTITY_KEYCHAIN)
       .deriveHardened(BLOCKSTACK_ON_BITCOIN)
       .deriveHardened(index)
       .derive(0));
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


// NOTE: legacy
function hashCode(string) {
  let hash = 0
  if (string.length === 0) return hash
  for (let i = 0; i < string.length; i++) {
    const character = string.charCodeAt(i)
    hash = (hash << 5) - hash + character
    hash = hash & hash
  }
  return hash & 0x7fffffff
}

export class AppNode {
  hdNode: Object
  appDomain: string

  constructor(hdNode: Object, appDomain: string) {
    this.hdNode = hdNode
    this.appDomain = appDomain
  }

  getAppPrivateKey() {
    return this.hdNode.keyPair.d.toBuffer(32).toString('hex')
  }

  getAddress() {
    return this.hdNode.getAddress()
  }
}

export class AppsNode {
  hdNode: Object
  salt: string

  constructor(appsHdNode: Object, salt: string) {
    this.hdNode = appsHdNode
    this.salt = salt
  }

  getNode() {
    return this.hdNode
  }

  getAppNode(appDomain: string) {
    const hash = crypto
      .createHash('sha256')
      .update(`${appDomain}${this.salt}`)
      .digest('hex')
    const appIndex = hashCode(hash)
    const appNode = this.hdNode.deriveHardened(appIndex)
    return new AppNode(appNode, appDomain)
  }

  toBase58() {
    return this.hdNode.toBase58()
  }

  getSalt() {
    return this.salt
  }
}

export function getIdentityPrivateKeychain(masterKeychain: Object) {
  return masterKeychain.deriveHardened(IDENTITY_KEYCHAIN).deriveHardened(BLOCKSTACK_ON_BITCOIN)
}

export function getIdentityPublicKeychain(masterKeychain: Object) {
  return getIdentityPrivateKeychain(masterKeychain).neutered()
}

export function getIdentityOwnerAddressNode(
  identityPrivateKeychain: Object, identityIndex: ?number = 0) {
  if (identityPrivateKeychain.isNeutered()) {
    throw new Error('You need the private key to generate identity addresses')
  }

  const publicKeyHex = identityPrivateKeychain.keyPair.getPublicKeyBuffer().toString('hex')
  const salt = crypto
    .createHash('sha256')
    .update(publicKeyHex)
    .digest('hex')

  return new IdentityAddressOwnerNode(identityPrivateKeychain.deriveHardened(identityIndex), salt)
}

export function deriveIdentityKeyPair(identityOwnerAddressNode: Object) {
  const address = identityOwnerAddressNode.getAddress()
  const identityKey = identityOwnerAddressNode.getIdentityKey()
  const identityKeyID = identityOwnerAddressNode.getIdentityKeyID()
  const appsNode = identityOwnerAddressNode.getAppsNode()
  const keyPair = {
    key: identityKey,
    keyID: identityKeyID,
    address,
    appsNodeKey: appsNode.toBase58(),
    salt: appsNode.getSalt()
  }
  return keyPair
}


/*
 * Get the owner key information for a 12-word phrase, at a specific index.
 * @network (object) the blockstack network
 * @mnemonic (string) the 12-word phrase
 * @index (number) the account index
 * @version (string) the derivation version string
 *
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .version (string) the version string of the derivation
 *    .idAddress (string) the ID-address
 */
export function getOwnerKeyInfo(network: Object,
                                mnemonic : string, 
                                index : number, 
                                version : string = 'v0.10-current') {
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
 * @network (object) the blockstack network
 * @mnemonic (string) the 12-word phrase
 * 
 * Returns an object with:
 *    .privateKey (string) the hex private key
 *    .address (string) the address of the private key
 */
export function getPaymentKeyInfo(network: Object, mnemonic : string) {
  const identity = getIdentityNodeFromPhrase(mnemonic, 0, 'current-btc');
  const addr = network.coerceAddress(identity.keyPair.getAddress());
  const privkey = identity.keyPair.d.toHex() + '01';
  return {
    privateKey: privkey,
    address: {
      BTC: addr,
      STACKS: c32check.b58ToC32(addr),
    },
    index: 0
  };
}

/*
 * Find the index of an ID address, given the mnemonic.
 * Returns the index if found
 * Returns -1 if not found
 */
export function findIdentityIndex(network: Object, mnemonic: string, idAddress: string, maxIndex: ?number = 16) {
  if (!maxIndex) {
    maxIndex = 16;
  }

  if (idAddress.substring(0,3) !== 'ID-') {
    throw new Error('Not an identity address');
  }

  for (let i = 0; i < maxIndex; i++) {
    const identity = getIdentityNodeFromPhrase(mnemonic, i, 'v0.10-current');
    if (network.coerceAddress(toAddress(identity)) === 
        network.coerceAddress(idAddress.slice(3))) {
      return i;
    }
  }

  return -1;
}

/*
 * Get the Gaia application key from a 12-word phrase
 * @network (object) the blockstack network
 * @mmemonic (string) the 12-word phrase
 * @idAddress (string) the ID-address used to sign in
 * @appDomain (string) the application's Origin
 *
 * Returns an object with
 *    .keyInfo (object) the app key info with the current derivation path 
 *      .privateKey (string) the app's hex private key
 *      .address (string) the address of the private key
 *    .legacyKeyInfo (object) the app key info with the legacy derivation path
 *      .privateKey (string) the app's hex private key
 *      .address (string) the address of the private key
 */
export function getApplicationKeyInfo(network: Object,
                                      mnemonic : string, 
                                      idAddress: string, 
                                      appDomain: string, 
                                      idIndex: ?number) {
  if (!idIndex) {
    idIndex = -1;
  }

  if (idIndex < 0) {
    idIndex = findIdentityIndex(network, mnemonic, idAddress);
    if (idIndex < 0) {
      throw new Error('Identity address does not belong to this keychain');
    }
  }

  const masterKeychain = getMaster(mnemonic);
  const identityPrivateKeychainNode = getIdentityPrivateKeychain(masterKeychain);
  const identityOwnerAddressNode = getIdentityOwnerAddressNode(
    identityPrivateKeychainNode, idIndex);

  // legacy app key (will update later to use the longer derivation path)
  const identityInfo = deriveIdentityKeyPair(identityOwnerAddressNode);
  const appsNodeKey = identityInfo.appsNodeKey;
  const salt = identityInfo.salt;
  const appsNode = new AppsNode(bitcoin.HDNode.fromBase58(appsNodeKey), salt);
  const appPrivateKey = appsNode.getAppNode(appDomain).getAppPrivateKey();

  const res = {
    keyInfo: {
      privateKey: 'TODO',
      address: 'TODO',
    },
    legacyKeyInfo: {
      privateKey: appPrivateKey,
      address: getPrivateKeyAddress(network, `${appPrivateKey}01`)
    },
    ownerKeyIndex: idIndex
  };
  return res;
}
