/* @flow */

import logger from 'winston';

const bitcoinjs = require('bitcoinjs-lib');
const blockstack = require('blockstack');
const URL = require('url');
const RIPEMD160 = require('ripemd160');
const readline = require('readline');
const stream = require('stream');
const fs = require('fs');

import {
  parseZoneFile
} from 'zone-file';

import ecurve from 'ecurve';

import { ECPair } from 'bitcoinjs-lib';
const secp256k1 = ecurve.getCurveByName('secp256k1');

import {
  PRIVATE_KEY_PATTERN,
  PRIVATE_KEY_MULTISIG_PATTERN,
  PRIVATE_KEY_SEGWIT_P2SH_PATTERN,
  ID_ADDRESS_PATTERN
} from './argparse';

import {
  TransactionSigner
} from 'blockstack';

import {
  decryptBackupPhrase
} from './encrypt';

import {
  getOwnerKeyInfo,
  getApplicationKeyInfo,
  extractAppKey,
} from './keys';

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
      logger.error(e);
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
    this.redeemScript = Buffer.from(redeemScript, 'hex');
    this.witnessScript = Buffer.from(witnessScript, 'hex');
    this.address = bitcoinjs.address.toBase58Check(
        bitcoinjs.crypto.hash160(this.redeemScript),
        blockstack.config.network.layer1.scriptHash)
   
    this.privateKeys = privateKeys;
    this.m = m;
  }

  getAddress() : Promise<string> {
    return Promise.resolve().then(() => this.address);
  }

  findUTXO(txIn: bitcoinjs.TransactionBuilder, signingIndex: number, utxos: Array<UTXO>) : UTXO {
    // NOTE: this is O(n*2) complexity for n UTXOs when signing an n-input transaction
    // NOTE: as of bitcoinjs-lib 4.x, the "tx" field is private
    const txidBuf = new Buffer(txIn.__tx.ins[signingIndex].hash.slice());
    const outpoint = txIn.__tx.ins[signingIndex].index;
    
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
  const multisigInfo = bitcoinjs.payments.p2ms({ m, pubkeys });
  return new MultiSigKeySigner(multisigInfo.output, privkeys);
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
  let witnessScript = '';
  if (m === 1) {
    // p2wpkh 
    const p2wpkh = bitcoinjs.payments.p2wpkh({ pubkey: pubkeys[0] });
    const p2sh = bitcoinjs.payments.p2sh({ redeem: p2wpkh });

    redeemScript = p2sh.redeem.output;
  }
  else {
    // p2wsh
    const p2ms = bitcoinjs.payments.p2ms({ m, pubkeys });
    const p2wsh = bitcoinjs.payments.p2wsh({ redeem: p2ms });
    const p2sh = bitcoinjs.payments.p2sh({ redeem: p2wsh });

    redeemScript = p2sh.redeem.output;
    witnessScript = p2wsh.redeem.output;
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
 * Get a private key's public key, while honoring the 01 to compress it.
 * @privateKey (string) the hex-encoded private key
 */
export function getPublicKeyFromPrivateKey(privateKey: string) : string {
  const ecKeyPair = blockstack.hexStringToECPair(privateKey);
  return ecKeyPair.publicKey.toString('hex');
}

/*
 * Get a private key's address.  Honor the 01 to compress the public key
 * @privateKey (string) the hex-encoded private key
 */
export function getPrivateKeyAddress(network: Object, privateKey: string | TransactionSigner) 
  : string {
  if (typeof privateKey === 'string') {
    const ecKeyPair = blockstack.hexStringToECPair(privateKey);
    return network.coerceAddress(blockstack.ecPairToAddress(ecKeyPair));
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
  return bitcoinjs.crypto.hash160(buff);
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
 * Sign a profile into a JWT
 */
export function makeProfileJWT(profileData: Object, privateKey: string) : string {
    const signedToken = blockstack.signProfileToken(profileData, privateKey);
    const wrappedToken = blockstack.wrapProfileToken(signedToken);
    const tokenRecords = [wrappedToken];
    return JSONStringify(tokenRecords);
}

/*
 * Broadcast a transaction and a zone file.
 * Returns an object that encodes the success/failure of doing so.
 * If zonefile is None, then only the transaction will be sent.
 */
export function broadcastTransactionAndZoneFile(network: Object,
                                                tx: string,
                                                zonefile: ?string = null) {
  let txid;
  return Promise.resolve().then(() => {
    return network.broadcastTransaction(tx);
  })
  .then((_txid) => {
    txid = _txid;
    if (zonefile) {
      return network.broadcastZoneFile(zonefile, txid);
    }
    else {
      return { 'status': true };
    }
  })
  .then((resp) => {
    if (!resp.status) {
      return {
        'status': false,
        'error': 'Failed to broadcast zone file',
        'txid': txid
      };
    }
    else {
      return {
        'status': true,
        'txid': txid
      };
    }
  })
  .catch((e) => {
    return {
      'status': false,
      'error': 'Caught exception sending transaction or zone file',
      'message': e.message,
      'stacktrace': e.stack
    }
  });
}


/*
 * Easier-to-use getNameInfo.  Returns null if the name does not exist.
 */
export function getNameInfoEasy(network: Object, name: string) : Promise<*> {
  const nameInfoPromise = network.getNameInfo(name)
    .then((nameInfo) => nameInfo)
    .catch((error) => {
      if (error.message === 'Name not found') {
        return null;
      } else {
        throw error;
      }
    });

  return nameInfoPromise;
}

/*
 * Look up a name's zone file, profile URL, and profile
 * Returns a Promise to the above, or throws an error.
 */
export function nameLookup(network: Object, name: string, includeProfile?: boolean = true) 
  : Promise<{ profile: Object | null, profileUrl: ?string, zonefile: ?string }> {

  const nameInfoPromise = getNameInfoEasy(network, name);
  const profilePromise = includeProfile ?
    blockstack.lookupProfile(name).catch(() => null) :
    Promise.resolve().then(() => null);

  const zonefilePromise = nameInfoPromise.then((nameInfo) => nameInfo ? nameInfo.zonefile : null);

  return Promise.resolve().then(() => {
    return Promise.all([profilePromise, zonefilePromise, nameInfoPromise])
  })
  .then(([profile, zonefile, nameInfo]) => {
    if (!nameInfo) {
      throw new Error('Name not found')
    }
    if (nameInfo.hasOwnProperty('grace_period') && nameInfo.grace_period) {
      throw new Error(`Name is expired at block ${nameInfo.expire_block} ` +
        `and must be renewed by block ${nameInfo.renewal_deadline}`);
    }

    let profileUrl = null;
    try {
      const zonefileJSON = parseZoneFile(zonefile);
      if (zonefileJSON.uri && zonefileJSON.hasOwnProperty('$origin')) {
        profileUrl = blockstack.getTokenFileUrl(zonefileJSON);
      }
    }
    catch(e) {
      profile = null;
    }

    const ret = {
      zonefile: zonefile,
      profile: profile,
      profileUrl: profileUrl
    };
    return ret;
  });
}

/*
 * Get a password.  Don't echo characters to stdout.
 * Password will be passed to the given callback.
 */
export function getpass(promptStr: string, cb: (passwd: string) => void) {
  const silentOutput = new stream.Writable({
    write: (chunk, encoding, callback) => {
      callback();
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: true
  });

  process.stderr.write(promptStr);
  rl.question('', (passwd) => {
    rl.close();
    process.stderr.write('\n');
    cb(passwd);
  });

  return;
}

/*
 * Extract a 12-word backup phrase.  If the raw 12-word phrase is given, it will
 * be returned.  If the ciphertext is given, the user will be prompted for a password
 * (if a password is not given as an argument).
 */
export function getBackupPhrase(backupPhraseOrCiphertext: string, password: ?string) : Promise<string> {
  if (backupPhraseOrCiphertext.split(/ +/g).length > 1) {
    // raw backup phrase 
    return Promise.resolve().then(() => backupPhraseOrCiphertext);
  }
  else {
    // ciphertext 
    return new Promise((resolve, reject) => {
      if (!process.stdin.isTTY && !password) {
        // password must be given 
        reject(new Error('Password argument required in non-interactive mode'));
      }
      else {
        // prompt password 
        getpass('Enter password: ', (p) => {
          resolve(p);
        });
      }
    })
    .then((pass) => decryptBackupPhrase(Buffer.from(backupPhraseOrCiphertext, 'base64'), pass));
  }
}

/*
 * mkdir -p
 * path must be absolute
 */
export function mkdirs(path: string) : void {
  if (path.length === 0 || path[0] !== '/') {
    throw new Error('Path must be absolute');
  }

  const pathParts = path.replace(/^\//, '').split('/');
  let tmpPath = '/';
  for (let i = 0; i <= pathParts.length; i++) {
    try {
      const statInfo = fs.lstatSync(tmpPath);
      if ((statInfo.mode & fs.constants.S_IFDIR) === 0) {
        throw new Error(`Not a directory: ${tmpPath}`);
      }
    }
    catch (e) {
      if (e.code === 'ENOENT') {
        // need to create
        fs.mkdirSync(tmpPath);
      }
      else {
        throw e;
      }
    }
    if (i === pathParts.length) {
      break;
    }
    tmpPath = `${tmpPath}/${pathParts[i]}`;
  }
}

/*
 * Given a name or ID address, return a promise to the ID Address
 */
export function getIDAddress(network: Object, nameOrIDAddress: string) : Promise<*> {
  let idAddressPromise;
  if (nameOrIDAddress.match(ID_ADDRESS_PATTERN)) {
    idAddressPromise = Promise.resolve().then(() => nameOrIDAddress);
  }
  else {
    // need to look it up 
    idAddressPromise = network.getNameInfo(nameOrIDAddress)
      .then((nameInfo) => `ID-${nameInfo.address}`);
  }
  return idAddressPromise;
}

/*
 * Find all identity addresses until we have one that matches the given one.
 * Loops forever if not found
 */
export function getOwnerKeyFromIDAddress(network: Object, 
                                         mnemonic: string, 
                                         idAddress: string
) : string {
  let index = 0;
  while(true) {
    const keyInfo = getOwnerKeyInfo(network, mnemonic, index);
    if (keyInfo.idAddress === idAddress) {
      return keyInfo.privateKey;
    }
    index++;
  }
  throw new Error('Unreachable')
}

/*
 * Given a name or an ID address and a possibly-encrypted mnemonic, get the owner and app
 * private keys.
 * May prompt for a password if mnemonic is encrypted.
 */
export function getIDAppKeys(network: Object, 
                             nameOrIDAddress: string,
                             appOrigin: string,
                             mnemonicOrCiphertext: string,
) : Promise<{ ownerPrivateKey: string, appPrivateKey: string, mnemonic: string }> {

  let mnemonic;
  let ownerPrivateKey;
  let appPrivateKey;

  return getBackupPhrase(mnemonicOrCiphertext)
    .then((mn) => {
      mnemonic = mn;
      return getIDAddress(network, nameOrIDAddress)
    })
    .then((idAddress) => {
      const appKeyInfo = getApplicationKeyInfo(network, mnemonic, idAddress, appOrigin);
      appPrivateKey = extractAppKey(appKeyInfo);
      ownerPrivateKey = getOwnerKeyFromIDAddress(network, mnemonic, idAddress);
      const ret = {
        appPrivateKey,
        ownerPrivateKey,
        mnemonic
      };
      return ret;
    });
}

