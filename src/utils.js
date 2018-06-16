/* @flow */

const bitcoinjs = require('bitcoinjs-lib');
const blockstack = require('blockstack');
const URL = require('url');
const RIPEMD160 = require('ripemd160')

import ecurve from 'ecurve';

import { ECPair } from 'bitcoinjs-lib';
const secp256k1 = ecurve.getCurveByName('secp256k1');

import {
  PRIVATE_KEY_PATTERN,
  PRIVATE_KEY_MULTISIG_PATTERN
} from './argparse';

import {
  TransactionSigner
} from 'blockstack';

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
type UTXO = { value?: number,
              confirmations?: number,
              tx_hash: string,
              tx_output_n: number }

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

