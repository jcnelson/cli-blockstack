/* @flow */

const Ajv = require('ajv');
const blockstack = require('blockstack');
const process = require('process');
const bitcoinjs = require('bitcoinjs-lib');
import ecurve from 'ecurve';

import { ECPair } from 'bitcoinjs-lib';
const secp256k1 = ecurve.getCurveByName('secp256k1');

const Promise = require('bluebird');
Promise.onPossiblyUnhandledRejection(function(error){
    throw error;
});

// global CLI options
let txOnly = false;
let estimateOnly = false;
let safetyChecks = true;

const BLOCKSTACK_TEST = process.env.BLOCKSTACK_TEST ? true : false;

const NAME_PATTERN = 
  '^([0-9a-z_.+-]{3,37})$'

const NAMESPACE_PATTERN = 
  '^([0-9a-z_-]{1,19})$'

const ADDRESS_PATTERN = 
  '^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,35})$';

const PRIVATE_KEY_PATTERN = 
  '^([0-9a-f]{64,66})$'

// CLI usage
const CLI_ARGS = {
  lookup: {
    type: "array",
    items: {
      type: "string",
      pattern: NAME_PATTERN
    },
    minItems: 1,
    maxItems: 1,
  },
  names: {
    type: "array",
    items: {
      type: "string",
      pattern: ADDRESS_PATTERN,
    },
    minItems: 1,
    maxItems: 1,
  },
  namespace_preorder: {
    type: 'array',
    items: [
      {
        type: 'string',
        pattern: NAMESPACE_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 3,
    maxItems: 3,
  },
  namespace_reveal: {
    type: 'array',
    items: [
      {
        type: 'string',
        pattern: NAMESPACE_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        // version
        type: 'integer',
        minimum: 0,
        maximum: 2**16 - 1,
      },
      {
        // lifetime
        type: 'integer',
        minimum: 0,
        maximum: 2**32 - 1,
      },
      {
        // coeff
        type: 'integer',
        minimum: 0,
        maximum: 255,
      },
      {
        // base
        type: 'integer',
        minimum: 0,
        maximum: 255,
      },
      {
        // buckets
        type: 'string',
        pattern: '^([0-9]{1,2},){15}[0-9]{1,2}$'
      },
      {
        // non-alpha discount
        type: 'string',
        minimum: 0,
        maximum: 15
      },
      {
        // no-vowel discount
        type: 'string',
        minimum: 0,
        maximum: 15,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 10,
    maxItems: 10,
  },
  namespace_ready: {
    type: 'array',
    items: [
      {
        type: 'string',
        pattern: NAMESPACE_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 2,
    maxItems: 2,
  },
  preorder: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN
      },
    ],
    minItems: 3,
    maxItems: 3,
  },
  price: {
    type: "array",
    items: {
      type: "string",
      pattern: NAME_PATTERN,
    },
    minItems: 3,
    maxItems: 3,
  },
  register: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        type: 'string',
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 4,
    maxItems: 4,
  },
  renew: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        type: 'string',
      },
    ],
    minItems: 3,
    maxItems: 5,
  },
  revoke: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 3,
    maxItems: 3,
  },
  transfer: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
        pattern: ADDRESS_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 4,
    maxItems: 4,
  },
  update: {
    type: "array",
    items: [
      {
        type: 'string',
        pattern: NAME_PATTERN,
      },
      {
        type: 'string',
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
      {
        type: 'string',
        pattern: PRIVATE_KEY_PATTERN,
      },
    ],
    minItems: 4,
    maxItems: 4,
  },
  whois: {
    type: "array",
    items: {
      type: "string",
      pattern: NAME_PATTERN
    },
    minItems: 4,
    maxItems: 4
  },
};

// usage string
const USAGE = `Usage: ${process.argv[0]} [options] command [command arguments]
Options can be:
    -e                  Estimate the BTC cost of an operation (in satoshis).
                        Do not generate or send any transactions.
    -t                  Use integration test framework
    -U                  Unsafe mode.  No safety checks will be performed.
    -x                  Do not broadcast a transaction.  Only generate and
                        print them.
   
Command can be:
    lookup NAME         Look up a name's profile
    names ADDR          List all names owned by an address
    namespace_preorder NAMESPACE REVEAL_ADDR PAYMENT_KEY
                        Preorder a namespace.  EXPENSIVE!
    namespace_reveal NAMESPACE REVEAL_ADDR VERSION LIFETIME COEFF BASE
      BUCKET_CSV NONALPHA_DISCOUNT NOVOWEL_DISCOUNT PAYMENT_KEY
                        Reveal a namespace with the given parameters
    namespace_ready NAMESPACE REVEAL_KEY
                        Launch a revealed namespace
    preorder NAME ADDR PAYMENT_KEY
                        Preorder a name to a given address
    price NAME          Find out how much a name costs
    register NAME ADDR NEW_ZONEFILE PAYMENT_KEY
                        Register a name to a given address, and
                        give it its first zone file
    revoke NAME OWNER_KEY PAYMENT_KEY
                        Revoke a name
    renew NAME OWNER_KEY PAYMENT_KEY [NEW_ADDR [NEW_ZONEFILE]]
                        Renew a name, optionally sending it to a new
                        address and giving it a new zone file
    transfer NAME NEW_ADDR OWNER_KEY PAYMENT_KEY
                        Transfer a name to a new address
    update NAME ZONEFILE OWNER_KEY PAYMENT_KEY
                        Update a name's zone file
    whois NAME          Get basic name information for a Blockstack ID
`;

/*
 * Implement just enough getopt(3) to be useful.
 * Only handles short options.
 * Returns an object whose keys are option flags that map to true/false,
 * or to a value.
 * The key _ is mapped to the non-opts list.
 */
function getCLIOpts(argv: Array<string>, opts: string) : Object {
  let optsTable = {};
  let remainingArgv = [];
  let argvBuff = argv.slice(0);

  for (let i = 0; i < opts.length; i++) {
    if (opts[i] == ':') {
      continue;
    }
    if (i+1 < opts.length && opts[i+1] == ':') {
      optsTable[opts[i]] = null;
    }
    else {
      optsTable[opts[i]] = false;
    }
  }

  for (let opt of Object.keys(optsTable)) {
    for (let i = 0; i < argvBuff.length; i++) {
      if (argvBuff[i] === null) {
        break;
      }
      if (argvBuff[i] === '--') {
        break;
      }

      const argvOpt = `-${opt}`;
      if (argvOpt === argvBuff[i]) {
        if (optsTable[opt] === false) {
          // boolean switch
          optsTable[opt] = true;
          argvBuff[i] = '';
        }
        else {
          // argument
          optsTable[opt] = argvBuff[i+1];
          argvBuff[i] = '';
          argvBuff[i+1] = '';
        }
      }
    }
  }

  for (let i = 0; i < argvBuff.length; i++) {
    if (argvBuff[i].length > 0) {
      if (argvBuff[i] === '--') {
        continue;
      }
      remainingArgv.push(argvBuff[i])
    }
  }

  optsTable['_'] = remainingArgv;
  return optsTable;
}


/*
 * Check command args
 */
type checkArgsSuccessType = {
  'success': true,
  'command': string,
  'args': Array<string>
};

type checkArgsFailType = {
  'success': false,
  'error': string,
  'usage': boolean
};

function checkArgs(argList: Array<string>) 
  : checkArgsSuccessType | checkArgsFailType {
  if (argList.length <= 2) {
     return {
       'success': false,
       'error': 'No command given',
       'usage': true
     }
  }

  const commandName = argList[2];
  const commandArgs = argList.slice(3);

  if (!CLI_ARGS.hasOwnProperty(commandName)) {
     return {
       'success': false,
       'error': `Unrecognized command '${commandName}'`,
       'usage': true
     };
  }

  const commands = {commandName: commandArgs};
  const ajv = Ajv();
  const valid = ajv.validate(CLI_ARGS, commands);
  if (!valid) {
     return {
       'success': false,
       'error': 'Invalid command arguments',
       'usage': true
     };
  }

  return {
    'success': true, 
    'command': commandName, 
    'args': commandArgs
  };
}

/*
 * Get a private key's address.  Honor the 01 to compress the public key
 * @privateKey (string) the hex-encoded private key
 */
function getPrivateKeyAddress(network: Object, privateKey: string) : string {
  const compressed = privateKey.substring(64,66) === '01';
  const publicKey = blockstack.getPublicKeyFromPrivate(
    privateKey.substring(0,64));
  const publicKeyBuffer = new Buffer(publicKey, 'hex');

  const Q = ecurve.Point.decodeFrom(secp256k1, publicKeyBuffer);
  const ecKeyPair = new ECPair(null, Q, { compressed: compressed });
  return network.coerceAddress(ecKeyPair.getAddress());
}

/* 
 * Get the sum of a set of UTXOs' values
 * @txIn (object) the transaction
 */
type UTXO = { value?: number,
              confirmations?: number,
              tx_hash: string,
              tx_output_n: number }

function sumUTXOs(utxos: Array<UTXO>) {
  return utxos.reduce((agg, x) => agg + x.value, 0);
}

/*
 * Get a name's record information
 * args:
 * @name (string) the name to query
 */
function whois(network: Object, args: Array<string>) {
  const name = args[0];
  return network.getNameInfo(name);
}

/*
 * Get a name's price information
 * args:
 * @name (string) the name to query
 */
function price(network: Object, args: Array<string>) {
  const name = args[0];
  return network.getNamePrice(name);
}

/*
 * Get names owned by an address
 * args:
 * @address (string) the address to query
 */
function names(network: Object, args: Array<string>) {
  const address = args[0];
  return network.getNamesOwned(address);
}

/*
 * Look up a name's profile
 * args:
 * @name (string) the name to look up
 */
function lookup(network: Object, args: Array<string>) {
  const name = args[0];
  const zonefileLookupUrl = network.blockstackAPIUrl + '/v1/names';
  return blockstack.lookupProfile(name, zonefileLookupUrl);
}

/*
 * Generate and optionally send a name-preorder
 * args:
 * @name (string) the name to preorder
 * @address (string) the address to own the name
 * @paymentKey (string) the payment private key
 */
function preorder(network: Object, args: Array<string>) {
  const name = args[0];
  const address = args[1];
  const paymentKey = args[2];
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  const txPromise = blockstack.transactions.makePreorder(
    name, address, paymentKey);

  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = paymentUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimatePreorder(
          name, network.coerceAddress(address), 
          network.coerceAddress(paymentAddress), numUTXOs);
      });

  if (estimateOnly) {
    return estimatePromise;
  }
  
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.isNameAvailable(name),
      blockstack.safety.addressCanReceiveName(
        network.coerceAddress(address)),
      blockstack.safety.isInGracePeriod(name),
      paymentBalance,
      estimatePromise
    ])
    .then(([isNameValid, isNameAvailable, addressCanReceiveName, 
            isInGracePeriod, paymentBalance, estimate]) => {
      if (isNameValid && isNameAvailable && addressCanReceiveName &&
          !isInGracePeriod && paymentBalance >= estimate) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely preordered',
          'isNameValid': isNameValid,
          'isNameAvailable': isNameAvailable,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a name-register
 * args:
 * @name (string) the name to register
 * @address (string) the address that owns this name
 * @zonefile (string) the zone file text to use
 * @paymentKey (string) the payment private key
 */
function register(network: Object, args: Array<string>) {
  const name = args[0];
  const address = args[1];
  const zonefile = args[2];
  const paymentKey = args[3];

  const paymentAddress = getPrivateKeyAddress(network, paymentKey);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = paymentUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateRegister(
          name, network.coerceAddress(address),
          network.coerceAddress(paymentAddress), true, numUTXOs);
      });

  const txPromise = blockstack.transactions.makeRegister(
    name, address, paymentKey, zonefile);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });
 
  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.isNameAvailable(name),
      blockstack.safety.addressCanReceiveName(
        network.coerceAddress(address)),
      blockstack.safety.isInGracePeriod(name)
    ])
    .then(([isNameValid, isNameAvailable, 
            addressCanReceiveName, isInGracePeriod]) => {
      if (isNameValid && isNameAvailable && addressCanReceiveName && 
          !isInGracePeriod) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely registered',
          'isNameValid': isNameValid,
          'isNameAvailable': isNameAvailable,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod
        };
      }
    });
  
  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a name-update
 * args:
 * @name (string) the name to update
 * @zonefile (string) the zonefile text to use
 * @ownerKey (string) the owner private key
 * @paymentKey (string) the payment private key
 */
function update(network: Object, args: Array<string>) {
  const name = args[0];
  const zonefile = args[1];
  const ownerKey = args[2];
  const paymentKey = args[3];
  const ownerAddress = getPrivateKeyAddress(network, ownerKey);
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  const ownerUTXOsPromise = network.getUTXOs(ownerAddress);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = Promise.all([
      ownerUTXOsPromise, paymentUTXOsPromise])
    .then(([ownerUTXOs, paymentUTXOs]) => {
        const numOwnerUTXOs = ownerUTXOs.length;
        const numPaymentUTXOs = paymentUTXOs.length;
        return blockstack.transactions.estimateUpdate(
          name, network.coerceAddress(ownerAddress),
          network.coerceAddress(paymentAddress),
          numOwnerUTXOs + numPaymentUTXOs - 1);
      });

  const txPromise = blockstack.transactions.makeUpdate(
    name, ownerKey, paymentKey, zonefile);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });
 
  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.ownsName(name, network.coerceAddress(ownerAddress)),
      blockstack.safety.isInGracePeriod(name)
    ])
    .then(([isNameValid, ownsName, isInGracePeriod]) => {
      if (isNameValid && ownsName && !isInGracePeriod) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely updated',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'isInGracePeriod': isInGracePeriod
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a name-transfer
 * args:
 * @name (string) the name to transfer
 * @address (string) the new owner address
 * @ownerKey (string) the owner private key
 * @paymentKey (string) the payment private key
 */
function transfer(network: Object, args: Array<string>) {
  const name = args[0];
  const address = args[1];
  const ownerKey = args[2];
  const paymentKey = args[3];
  const ownerAddress = getPrivateKeyAddress(network, ownerKey);
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  const ownerUTXOsPromise = network.getUTXOs(ownerAddress);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = Promise.all([
      ownerUTXOsPromise, paymentUTXOsPromise])
    .then(([ownerUTXOs, paymentUTXOs]) => {
        const numOwnerUTXOs = ownerUTXOs.length;
        const numPaymentUTXOs = paymentUTXOs.length;
        return blockstack.transactions.estimateTransfer(
          name, network.coerceAddress(address),
          network.coerceAddress(ownerAddress), 
          network.coerceAddress(paymentAddress),
          numOwnerUTXOs + numPaymentUTXOs - 1);
      });

  const txPromise = blockstack.transactions.makeTransfer(
    name, address, ownerKey, paymentKey);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });
  
  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.ownsName(name, network.coerceAddress(ownerAddress)),
      blockstack.safety.addressCanReceiveName(network.coerceAddress(address)),
      blockstack.safety.isInGracePeriod(name)
    ])
    .then(([isNameValid, ownsName, addressCanReceiveName, 
            isInGracePeriod]) => {
      if (isNameValid && ownsName && addressCanReceiveName &&
          !isInGracePeriod) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely transferred',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a name-renewal
 * args:
 * @name (string) the name to renew
 * @ownerKey (string) the owner private key
 * @paymentKey (string) the payment private key 
 * @address (string) OPTIONAL: the new owner address
 * @zonefile (string) OPTIONAL: the new zone file
 */
function renew(network: Object, args: Array<string>) {
  const name = args[0];
  const ownerKey = args[1];
  const paymentKey = args[2];
  const ownerAddress = getPrivateKeyAddress(network, ownerKey);
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  let newAddress = null;
  let zonefile = null;

  if (args.length == 3) {
    newAddress = getPrivateKeyAddress(network, ownerKey);
  }
  else {
    newAddress = args[3];
  }

  if (args.length == 5) {
    zonefile = args[4];
  }

  const ownerUTXOsPromise = network.getUTXOs(ownerAddress);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = Promise.all([
      ownerUTXOsPromise, paymentUTXOsPromise])
    .then(([ownerUTXOs, paymentUTXOs]) => {
        const numOwnerUTXOs = ownerUTXOs.length;
        const numPaymentUTXOs = paymentUTXOs.length;
        return blockstack.transactions.estimateRenewal(
          name, network.coerceAddress(newAddress), 
          network.coerceAddress(ownerAddress),
          network.coerceAddress(paymentAddress), true, 
          numOwnerUTXOs + numPaymentUTXOs - 1);
      });

  const txPromise = blockstack.transactions.makeRenewal(
    name, newAddress, ownerKey, paymentKey, zonefile);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.ownsName(name, network.coerceAddress(ownerAddress)),
      newAddress !== null ? blockstack.safety.addressCanReceiveName(
        network.coerceAddress(newAddress)) : true,
    ])
    .then(([isNameValid, ownsName, addressCanReceiveName]) => {
      if (isNameValid && ownsName && addressCanReceiveName) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely transferred',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'addressCanReceiveName': addressCanReceiveName
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a name-revoke
 * args:
 * @name (string) the name to revoke
 * @ownerKey (string) the owner private key
 * @paymentKey (string) the payment private key
 */
function revoke(network: Object, args: Array<string>) {
  const name = args[0];
  const ownerKey = args[1];
  const paymentKey = args[2];
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);
  const ownerAddress = getPrivateKeyAddress(network, ownerKey);

  const ownerUTXOsPromise = network.getUTXOs(ownerAddress);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = Promise.all([
      ownerUTXOsPromise, paymentUTXOsPromise])
    .then(([ownerUTXOs, paymentUTXOs]) => {
        const numOwnerUTXOs = ownerUTXOs.length;
        const numPaymentUTXOs = paymentUTXOs.length;
        return blockstack.transactions.estimateRevoke(
          name, network.coerceAddress(ownerAddress),
          network.coerceAddress(paymentAddress),
          numOwnerUTXOs + numPaymentUTXOs - 1);
    });

  const txPromise =  blockstack.transactions.makeRevoke(
    name, ownerKey, paymentKey);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });
 
  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNameValid(name),
      blockstack.safety.ownsName(name, network.coerceAddress(ownerAddress)),
      blockstack.safety.isInGracePeriod(name)
    ])
    .then(([isNameValid, ownsName, isInGracePeriod]) => {
      if (isNameValid && ownsName && !isInGracePeriod) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely updated',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'isInGracePeriod': isInGracePeriod
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a namespace-preorder
 * args:
 * @namespace (string) the namespace to preorder
 * @address (string) the address to reveal the namespace
 * @paymentKey (string) the payment private key
 */
function namespacePreorder(network: Object, args: Array<string>) {
  const namespaceID = args[0];
  const address = args[1];
  const paymentKey = args[2];
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  const txPromise = blockstack.transactions.makeNamespacePreorder(
    namespaceID, address, paymentKey);

  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = paymentUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateNamespacePreorder(
          namespaceID, network.coerceAddress(address), 
          network.coerceAddress(paymentAddress), numUTXOs);
      });

  if (estimateOnly) {
    return estimatePromise;
  }
  
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNamespaceValid(namespaceID),
      blockstack.safety.isNamespaceAvailable(namespaceID),
      network.getNamespacePrice(namespaceID),
      network.getAccountBalance(paymentAddress, 'STACKS'),
      paymentBalance,
      estimatePromise
    ])
    .then(([isNamespaceValid, isNamespaceAvailable, namespacePrice,
            STACKSBalance, paymentBalance, estimate]) => {
      if (isNamespaceValid && isNamespaceAvailable && 
          (namespacePrice.units === 'BTC' || 
            (namespacePrice.units === 'STACKS' && 
             namespacePrice.amount.compareTo(STACKSBalance) < 0)) &&
          paymentBalance >= estimate) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Namespace cannot be safely preordered',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceAvailable': isNamespaceAvailable,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate,
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a namespace-reveal
 * args:
 * @name (string) the namespace to reveal
 * @revealAddr (string) the reveal address
 * @version (int) the namespace version bits
 * @lifetime (int) the name lifetime
 * @coeff (int) the multiplicative price coefficient
 * @base (int) the price base
 * @bucketString (string) the serialized bucket exponents
 * @nonalphaDiscount (int) the non-alpha price discount
 * @noVowelDiscount (int) the no-vowel price discount
 * @paymentKey (string) the payment private key
 */
function namespaceReveal(network: Object, args: Array<string>) {
  const namespaceID = args[0];
  const revealAddr = args[1];
  const version = parseInt(args[2]);
  const lifetime = parseInt(args[3]);
  const coeff = parseInt(args[4]);
  const base = parseInt(args[5]);
  const bucketString = args[6];
  const nonalphaDiscount = parseInt(args[7]);
  const noVowelDiscount = parseInt(args[8]);
  const paymentKey = args[9];

  const buckets = bucketString.split(',')
    .map((x) => {return parseInt(x)});

  const namespace = new blockstack.transactions.BlockstackNamespace(
    namespaceID)

  namespace.setVersion(version)
  namespace.setLifetime(lifetime)
  namespace.setCoeff(coeff)
  namespace.setBase(base)
  namespace.setBuckets(buckets)
  namespace.setNonalphaDiscount(nonalphaDiscount)
  namespace.setNoVowelDiscount(noVowelDiscount)

  const paymentAddress = getPrivateKeyAddress(network, paymentKey);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = paymentUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateNamespaceReveal(
          namespace, network.coerceAddress(revealAddr),
          network.coerceAddress(paymentAddress), numUTXOs);
      });

  const txPromise = blockstack.transactions.makeNamespaceReveal(
    namespace, revealAddr, paymentKey);

  if (estimateOnly) {
    return estimatePromise;
  }
 
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const paymentBalance = paymentUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });
 
  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNamespaceValid(namespaceID),
      blockstack.safety.isNamespaceAvailable(namespaceID),
      paymentBalance,
      estimatePromise
    ])
    .then(([isNamespaceValid, isNamespaceAvailable,
            paymentBalance, estimate]) => {
      if (isNamespaceValid && isNamespaceAvailable && 
          paymentBalance >= estimate) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Namespace cannot be safely revealed',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceAvailable': isNamespaceAvailable,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate,
        };
      }
    });
  
  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Generate and optionally send a namespace-ready
 * args:
 * @namespaceID (string) the namespace ID
 * @revealKey (string) the hex-encoded reveal key
 */
function namespaceReady(network: Object, args: Array<string>) {
  const namespaceID = args[0];
  const revealKey = args[1];
  const revealAddress = getPrivateKeyAddress(network, revealKey);

  const txPromise = blockstack.transactions.makeNamespaceReady(
    namespaceID, revealKey);

  const revealUTXOsPromise = network.getUTXOs(revealAddress);

  const estimatePromise = revealUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateNamespaceReady(
          namespaceID, network.coerceAddress(revealAddress), numUTXOs);
      });

  if (estimateOnly) {
    return estimatePromise;
  }
  
  if (!safetyChecks) {
    if (txOnly) {
      return txPromise;
    }
    else {
      return txPromise
        .then((tx) => {
          return network.broadcastTransaction(tx);
        });
    }
  }

  const revealBalance = revealUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all([
      blockstack.safety.isNamespaceValid(namespaceID),
      blockstack.safety.namespaceIsReady(namespaceID),
      blockstack.safety.revealedNamespace(namespaceID, revealAddress),
      revealBalance,
      estimatePromise
    ])
    .then(([isNamespaceValid, isNamespaceReady, isRevealer,
            revealerBalance, estimate]) => {
      if (isNamespaceValid && !isNamespaceReady && isRevealer &&
          revealerBalance >= estimate) {
        return {'status': true};
      }
      else {
        return {
          'status': false,
          'error': 'Name cannot be safely launched',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceReady': isNamespaceReady,
          'isRevealer': isRevealer,
          'revealerBalance': revealerBalance,
          'estimateCost': estimate
        };
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        throw new Error(JSON.stringify(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        network.broadcastTransaction(tx);
      });
    });
}

/*
 * Global set of commands
 */
const COMMANDS = {
  'lookup': lookup,
  'names': names,
  'namespace_preorder': namespacePreorder,
  'namespace_reveal': namespaceReveal,
  'namespace_ready': namespaceReady,
  'preorder': preorder,
  'price': price,
  'register': register,
  'renew': renew,
  'revoke': revoke,
  'transfer': transfer,
  'update': update,
  'whois': whois
};

/*
 * CLI main entry point
 */
export function CLIMain() {
  const argv = process.argv;
  const opts = getCLIOpts(argv, 'txeU');

  const cmdArgs = checkArgs(opts._);
  if (!cmdArgs.success) {
    console.error(cmdArgs.error);
    if (cmdArgs.usage) {
      console.error(USAGE);
    }
    process.exit(1);
  }
  else {
    txOnly = opts['x'];
    estimateOnly = opts['e'];
    safetyChecks = !opts['U'];
    const testnet = opts['t'];

    const blockstackNetwork = (BLOCKSTACK_TEST || testnet) ? 
      blockstack.network.defaults.LOCAL_REGTEST : 
      blockstack.network.defaults.MAINNET_DEFAULT;

    blockstack.config.network = blockstackNetwork;

    console.log(opts);
    const method = COMMANDS[cmdArgs.command];
    method(blockstackNetwork, cmdArgs.args)
    .then((result) => console.log(result))
    .then(() => process.exit(0))
    .catch((e) => {
       console.error(e);
     });
  }
}


