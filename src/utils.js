/* @flow */

const bitcoinjs = require('bitcoinjs-lib');
const blockstack = require('blockstack');
const URL = require('url');
const RIPEMD160 = require('ripemd160');
const c32check = require('c32check');

import ecurve from 'ecurve';

import { ECPair } from 'bitcoinjs-lib';
const secp256k1 = ecurve.getCurveByName('secp256k1');

import {
  PRIVATE_KEY_PATTERN,
  PRIVATE_KEY_MULTISIG_PATTERN,
  PRIVATE_KEY_SEGWIT_P2SH_PATTERN
} from './argparse';

import {
  TransactionSigner
} from 'blockstack';

type UTXO = { value?: number,
              confirmations?: number,
              tx_hash: string,
              tx_output_n: number }


export class MultiSigKeySigner implements TransactionSigner {
  redeemScript: Buffer
  privateKeys: Array<string>
  address: string
  m: number
  constructor(redeemScript: string, privateKeys: Array<string>) {
    this.redeemScript = Buffer.from(redeemScript, 'hex')
    this.privateKeys = privateKeys
    try {
      // try to deduce m (as in m-of-n)
      const chunks = bitcoinjs.script.decompile(this.redeemScript)
      const firstOp = chunks[0]
      this.m = parseInt(bitcoinjs.script.toASM([firstOp]).slice(3), 10)
      this.address = bitcoinjs.address.toBase58Check(
          bitcoinjs.crypto.hash160(this.redeemScript),
          blockstack.config.network.layer1.scriptHash)
    } catch (e) {
      console.log(e.stack)
      throw new Error('Improper redeem script for multi-sig input.')
    }
  }

  getAddress() : Promise<string> {
    return Promise.resolve().then(() => this.address);
  }

  signTransaction(txIn: bitcoinjs.TransactionBuilder, signingIndex: number) : Promise<void> {
    return Promise.resolve().then(() => {
      const keysToUse = this.privateKeys.slice(0, this.m)
      keysToUse.forEach((keyHex) => {
        const ecPair = blockstack.hexStringToECPair(keyHex)
        txIn.sign(signingIndex, ecPair, this.redeemScript)
      })
    });
  }
}


export class SegwitP2SHKeySigner implements TransactionSigner {
  redeemScript: Buffer
  witnessScript: Buffer
  privateKeys: Array<string>
  address: string
  m: number
  constructor(redeemScript: string, witnessScript: string, m: number, privateKeys: Array<string>) {

    const scriptPubKey = bitcoinjs.script.scriptHash.output.encode(
      bitcoinjs.crypto.hash160(redeemScript));

    this.address = bitcoinjs.address.fromOutputScript(
      scriptPubKey, blockstack.config.network.layer1); 
    this.redeemScript = Buffer.from(redeemScript, 'hex');
    this.witnessScript = Buffer.from(witnessScript, 'hex');
    this.privateKeys = privateKeys;
    this.m = m;
  }

  getAddress() : Promise<string> {
    return Promise.resolve().then(() => this.address);
  }

  findUTXO(txIn: bitcoinjs.TransactionBuilder, signingIndex: number, utxos: Array<UTXO>) : UTXO {
    // NOTE: this is O(n*2) complexity for n UTXOs when signing an n-input transaction
    const txidBuf = new Buffer(txIn.tx.ins[signingIndex].hash.slice());
    const outpoint = txIn.tx.ins[signingIndex].index;
    
    txidBuf.reverse(); // NOTE: bitcoinjs encodes txid as big-endian
    const txid = txidBuf.toString('hex')

    for (let i = 0; i < utxos.length; i++) {
      if (utxos[i].tx_hash === txid && utxos[i].tx_output_n === outpoint) {
        if (!utxos[i].value) {
          throw new Error(`UTXO for hash=${txid} vout=${outpoint} has no value`);
        }
        return utxos[i];
      }
    }
    throw new Error(`No UTXO for input hash=${txid} vout=${outpoint}`);
  }

  signTransaction(txIn: bitcoinjs.TransactionBuilder, signingIndex: number) : Promise<void> {
    // This is an interface issue more than anything else.  Basically, in order to
    // form the segwit sighash, we need the UTXOs.  If we knew better, we would have
    // blockstack.js simply pass the consumed UTXO into this method.  But alas, we do
    // not.  Therefore, we need to re-query them.  This is probably fine, since we're
    // not pressured for time when it comes to generating transactions.
    return Promise.resolve().then(() => {
        return this.getAddress();
      })
      .then((address) => {
        return blockstack.config.network.getUTXOs(address);
      })
      .then((utxos) => {
        const utxo = this.findUTXO(txIn, signingIndex, utxos);
        if (this.m === 1) {
          // p2sh-p2wpkh
          const ecPair = blockstack.hexStringToECPair(this.privateKeys[0]);
          txIn.sign(signingIndex, ecPair, this.redeemScript, null, utxo.value);
        }
        else {
          // p2sh-p2wsh
          const keysToUse = this.privateKeys.slice(0, this.m)
          keysToUse.forEach((keyHex) => {
            const ecPair = blockstack.hexStringToECPair(keyHex)
            txIn.sign(signingIndex, ecPair, this.redeemScript, null, utxo.value, this.witnessScript);
          });
        }
      });
  }
}

export class SafetyError extends Error {
  safetyErrors: Object
  constructor(safetyErrors: Object) {
    super(JSONStringify(safetyErrors, true));
    this.safetyErrors = safetyErrors;
  }
}


/*
 * Parse a string into a MultiSigKeySigner.
 * The string has the format "m,pk1,pk2,...,pkn"
 * @serializedPrivateKeys (string) the above string
 * @return a MultiSigKeySigner instance
 */
export function parseMultiSigKeys(serializedPrivateKeys: string) : MultiSigKeySigner {
  const matches = serializedPrivateKeys.match(PRIVATE_KEY_MULTISIG_PATTERN);
  if (!matches) {
    throw new Error('Invalid multisig private key string');
  }
  
  const m = parseInt(matches[1]);
  const parts = serializedPrivateKeys.split(',');
  const privkeys = [];
  for (let i = 1; i < 256; i++) {
    const pk = parts[i];
    if (!pk) {
      break;
    }

    if (!pk.match(PRIVATE_KEY_PATTERN)) {
      throw new Error('Invalid private key string');
    }

    privkeys.push(pk);
  }

  // generate public keys 
  const pubkeys = privkeys.map((pk) => {
    return Buffer.from(getPublicKeyFromPrivateKey(pk), 'hex');
  });

  // generate redeem script 
  const redeemScript = bitcoinjs.script.multisig.output.encode(m, pubkeys);
  return new MultiSigKeySigner(redeemScript, privkeys);
}


/*
 * Parse a string into a SegwitP2SHKeySigner
 * The string has the format "segwit:p2sh:m,pk1,pk2,...,pkn"
 * @serializedPrivateKeys (string) the above string
 * @return a MultiSigKeySigner instance
 */
export function parseSegwitP2SHKeys(serializedPrivateKeys: string) : SegwitP2SHKeySigner {
  const matches = serializedPrivateKeys.match(PRIVATE_KEY_SEGWIT_P2SH_PATTERN);
  if (!matches) {
    throw new Error('Invalid segwit p2sh private key string');
  }
  
  const m = parseInt(matches[1]);
  const parts = serializedPrivateKeys.split(',');
  const privkeys = [];
  for (let i = 1; i < 256; i++) {
    const pk = parts[i];
    if (!pk) {
      break;
    }

    if (!pk.match(PRIVATE_KEY_PATTERN)) {
      throw new Error('Invalid private key string');
    }

    privkeys.push(pk);
  }

  // generate public keys 
  const pubkeys = privkeys.map((pk) => {
    return Buffer.from(getPublicKeyFromPrivateKey(pk), 'hex');
  });

  // generate redeem script for p2wpkh or p2sh, depending on how many keys 
  let redeemScript;
  let scriptPubKey;
  let witnessScript = '';
  if (m === 1) {
    // p2wpkh 
    const pubKeyHash = bitcoinjs.crypto.hash160(pubkeys[0]);
    redeemScript = bitcoinjs.script.witnessPubKeyHash.output.encode(pubKeyHash);
    scriptPubKey = bitcoinjs.script.scriptHash.output.encode(
      bitcoinjs.crypto.hash160(redeemScript));
  }
  else {
    // p2wsh
    witnessScript = bitcoinjs.script.multisig.output.encode(m, pubkeys);
    redeemScript = bitcoinjs.script.witnessScriptHash.output.encode(
      bitcoinjs.crypto.sha256(witnessScript));
    scriptPubKey = bitcoinjs.script.scriptHash.output.encode(
      bitcoinjs.crypto.hash160(redeemScript));
  }

  return new SegwitP2SHKeySigner(redeemScript, witnessScript, m, privkeys);
}

/*
 * Decode one or more private keys from a string.
 * Can be used to parse single private keys (as strings),
 * or multisig bundles (as TransactionSigners)
 * @serializedPrivateKey (string) the private key, encoded
 * @return a TransactionSigner or a String
 */
export function decodePrivateKey(serializedPrivateKey: string) : string | TransactionSigner {
  const singleKeyMatches = serializedPrivateKey.match(PRIVATE_KEY_PATTERN);
  if (!!singleKeyMatches) {
    // one private key 
    return serializedPrivateKey;
  }

  const multiKeyMatches = serializedPrivateKey.match(PRIVATE_KEY_MULTISIG_PATTERN);
  if (!!multiKeyMatches) {
    // multisig bundle 
    return parseMultiSigKeys(serializedPrivateKey);
  }

  const segwitP2SHMatches = serializedPrivateKey.match(PRIVATE_KEY_SEGWIT_P2SH_PATTERN);
  if (!!segwitP2SHMatches) {
    // segwit p2sh bundle
    return parseSegwitP2SHKeys(serializedPrivateKey);
  }

  throw new Error('Unparseable private key');
}

/*
 * JSON stringify helper
 * -- if stdout is a TTY, then pretty-format the JSON
 * -- otherwise, print it all on one line to make it easy for programs to consume
 */
export function JSONStringify(obj: any, stderr: boolean = false) : string {
  if ((!stderr && process.stdout.isTTY) || (stderr && process.stderr.isTTY)) {
    return JSON.stringify(obj, null, 2);
  }
  else {
    return JSON.stringify(obj);
  }
}

/*
 * Get an ECPair public key from a private key
 */
function getECPairFromPrivateKey(privateKey: string) : ECPair {
  const compressed = privateKey.substring(64,66) === '01';
  const publicKey = blockstack.getPublicKeyFromPrivate(
    privateKey.substring(0,64));
  const publicKeyBuffer = new Buffer(publicKey, 'hex');

  const Q = ecurve.Point.decodeFrom(secp256k1, publicKeyBuffer);
  const ecKeyPair = new ECPair(null, Q, { compressed: compressed });
  return ecKeyPair;
}

/*
 * Get a private key's public key, while honoring the 01 to compress it.
 * @privateKey (string) the hex-encoded private key
 */
export function getPublicKeyFromPrivateKey(privateKey: string) : string {
  const ecKeyPair = getECPairFromPrivateKey(privateKey);
  return ecKeyPair.getPublicKeyBuffer().toString('hex');
}

/*
 * Get a private key's address.  Honor the 01 to compress the public key
 * @privateKey (string) the hex-encoded private key
 */
export function getPrivateKeyAddress(network: Object, privateKey: string | TransactionSigner) 
  : string {
  if (typeof privateKey === 'string') {
    const ecKeyPair = getECPairFromPrivateKey(privateKey);
    return network.coerceAddress(ecKeyPair.getAddress());
  }
  else {
    return privateKey.address;
  }
}

/*
 * Is a name a sponsored name (a subdomain)?
 */
export function isSubdomain(name: string) : boolean {
  return !!name.match(/^[^\.]+\.[^.]+\.[^.]+$/);
}

/*
 * Get the canonical form of a hex-encoded private key
 * (i.e. strip the trailing '01' if present)
 */
export function canonicalPrivateKey(privkey: string) : string {
  if (privkey.length == 66 && privkey.slice(-2) === '01') {
    return privkey.substring(0,64);
  }
  return privkey;
}
    
/* 
 * Get the sum of a set of UTXOs' values
 * @txIn (object) the transaction
 */
export function sumUTXOs(utxos: Array<UTXO>) {
  return utxos.reduce((agg, x) => agg + x.value, 0);
}

/*
 * Hash160 function for zone files
 */
export function hash160(buff: Buffer) {
  const sha256 = bitcoinjs.crypto.sha256(buff)
  return (new RIPEMD160()).update(sha256).digest()
}

/*
 * Normalize a URL--remove duplicate /'s from the root of the path.
 * Throw an exception if it's not well-formed.
 */
export function checkUrl(url: string) : string {
  let urlinfo = URL.parse(url);
  if (!urlinfo.protocol) {
    throw new Error(`Malformed full URL: missing scheme in ${url}`);
  }
 
  if (!urlinfo.path || urlinfo.path.startsWith('//')) {
    throw new Error(`Malformed full URL: path root has multiple /'s: ${url}`);
  }

  return url;
}

/*
 * Connect to Gaia hub.  Make sure we use a mainnet address always, even in test mode
 * (works around a bug in some versions of blockstack.js)
 */
export function gaiaConnect(network: Object, gaiaHubUrl: string, privateKey: string) {
  const addressMainnet = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, `${canonicalPrivateKey(privateKey)}01`))
  const addressMainnetCanonical = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, canonicalPrivateKey(privateKey)))

  return blockstack.connectToGaiaHub(gaiaHubUrl, canonicalPrivateKey(privateKey))
    .then((hubConfig) => {
      if (network.coerceMainnetAddress(hubConfig.address) === addressMainnet) {
        hubConfig.address = addressMainnet;
      }
      else if (network.coerceMainnetAddress(hubConfig.address) === addressMainnetCanonical) {
        hubConfig.address = addressMainnetCanonical;
      }
      else {
        throw new Error('Invalid private key: ' +
          `${network.coerceMainnetAddress(hubConfig.address)} is neither ` +
          `${addressMainnet} or ${addressMainnetCanonical}`);
      }

      /*
      if (network.coerceMainnetAddress(hubConfig.address) !== addressMainnet) {
        throw new Error('Invalid private key: ' +
          `${network.coerceMainnetAddress(hubConfig.address)} != ${addressMainnet}`);
      }
      // this fixes a bug in some versions of blockstack.js
      hubConfig.address = addressMainnet;
      */
      return hubConfig;
    });
}

/*
 * Sign a profile into a JWT
 */
export function makeProfileJWT(profileData: Object, privateKey: string) : string {
    const signedToken = blockstack.signProfileToken(profileData, privateKey);
    const wrappedToken = blockstack.wrapProfileToken(signedToken);
    const tokenRecords = [wrappedToken];
    return JSONStringify(tokenRecords);
}
