/* @flow */

const blockstack = require('blockstack');
import process from 'process';
import bitcoinjs from 'bitcoinjs-lib';
import ecurve from 'ecurve';
import fs from 'fs';
const URL = require('url')

import {
  parseZoneFile
} from 'zone-file';

import { ECPair } from 'bitcoinjs-lib';
const secp256k1 = ecurve.getCurveByName('secp256k1');

const Promise = require('bluebird');
Promise.onPossiblyUnhandledRejection(function(error){
    throw error;
});

import {
  getCLIOpts,
  printUsage,
  checkArgs,
  loadConfig,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG_REGTEST_PATH,
  ADDRESS_PATTERN
} from './argparse';

import {
  CLIRegtestNetworkAdapter,
  getNetwork
} from './network';

// global CLI options
let txOnly = false;
let estimateOnly = false;
let safetyChecks = true;

const BLOCKSTACK_TEST = process.env.BLOCKSTACK_TEST ? true : false;

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
 * Coerse an address to be a mainnet address
 */
function coerceMainnetAddress(address: string) : string {
  const addressHash = bitcoinjs.address.fromBase58Check(address).hash
  return bitcoinjs.address.toBase58Check(addressHash, 0)
}

/*
 * Get the canonical form of a hex-encoded private key
 * (i.e. strip the trailing '01' if present)
 */
function canonicalPrivateKey(privkey: string) : string {
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
  return network.getNameInfo(name)
    .then(nameInfo => JSON.stringify(nameInfo));
}

/*
 * Get a name's price information
 * args:
 * @name (string) the name to query
 */
function price(network: Object, args: Array<string>) {
  const name = args[0];
  return network.getNamePrice(name)
    .then(priceInfo => JSON.stringify(priceInfo));
}

/*
 * Get names owned by an address
 * args:
 * @address (string) the address to query
 */
function names(network: Object, args: Array<string>) {
  const address = args[0];
  return network.getNamesOwned(address)
    .then(namesList => JSON.stringify(namesList));
}

/*
 * Look up a name's profile and zonefile
 * args:
 * @name (string) the name to look up
 */
function lookup(network: Object, args: Array<string>) {
  const name = args[0];
  const zonefileLookupUrl = network.blockstackAPIUrl + '/v1/names';

  const profilePromise = blockstack.lookupProfile(name, zonefileLookupUrl);
  const zonefilePromise = Promise.resolve().then(() => {
      return network.getNameInfo(name)
    })
    .then(nameInfo => nameInfo.zonefile);

  return Promise.all([profilePromise, zonefilePromise])
    .then(([profile, zonefile]) => {
      const ret = {
        zonefile: zonefile,
        profile: profile
      };
      return JSON.stringify(ret);
    });
}

/*
 * Get a name's blockchain record
 * args:
 * @name (string) the name to query
 */
function getNameBlockchainRecord(network: Object, args: Array<string>) {
  const name = args[0];
  return Promise.resolve().then(() => {
    return network.getBlockchainNameRecord(name);
  })
  .then((nameInfo) => {
    return JSON.stringify(nameInfo);
  });
}

/*
 * Get a name's history entry or entries
 * args:
 * @name (string) the name to query
 * @startHeight (int) optional: the start of the history range
 * @endHeight (int) optional: the end of the history range
 */
function getNameHistoryRecord(network: Object, args: Array<string>) {
  const name = args[0];
  let startHeight = null;
  let endHeight = null;

  if (args.length >= 2) {
    startHeight = parseInt(args[1]);
  }
  if (args.length >= 3) {
    endHeight = parseInt(args[2]);
  }

  return Promise.resolve().then(() => {
    return network.getNameHistory(name, startHeight, endHeight);
  })
  .then((nameHistory) => {
    return JSON.stringify(nameHistory);
  });
}

/*
 * Get a namespace's blockchain record
 * args:
 * @namespaceID (string) the namespace to query
 */
function getNamespaceBlockchainRecord(network: Object, args: Array<string>) {
  const namespaceID = args[0];
  return Promise.resolve().then(() => {
    return network.getNamespaceInfo(namespaceID);
  })
  .then((namespaceInfo) => {
    return JSON.stringify(namespaceInfo);
  });
}

/*
 * Get a name's zone file
 * args:
 * @name (string) the name to query
 */
function getNameZonefile(network: Object, args: Array<string>) {
  const name = args[0];
  return Promise.resolve().then(() => {
      return network.getNameInfo(name)
    })
    .then(nameInfo => nameInfo.zonefile);
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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely preordered',
          'isNameValid': isNameValid,
          'isNameAvailable': isNameAvailable,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
      });
    });
}

/*
 * Generate and optionally send a name-register
 * args:
 * @name (string) the name to register
 * @address (string) the address that owns this name
 * @paymentKey (string) the payment private key
 * @zonefile (string) if given, the zone file text to use
 * @zonefileHash (string) if given, this is the raw zone file hash to use
 *  (in which case, @zonefile will be ignored)
 */
function register(network: Object, args: Array<string>) {
  const name = args[0];
  const address = args[1];
  const paymentKey = args[2];
  let zonefile = null;
  let zonefileHash = null;

  if (args.length > 3) {
    zonefile = args[3];
  }

  if (args.length > 4) {
    zonefileHash = args[4];
    zonefile = null;

    console.log(`Using zone file hash ${zonefileHash} instead of zone file`);
  }

  const paymentAddress = getPrivateKeyAddress(network, paymentKey);
  const paymentUTXOsPromise = network.getUTXOs(paymentAddress);

  const estimatePromise = paymentUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateRegister(
          name, network.coerceAddress(address),
          network.coerceAddress(paymentAddress), true, numUTXOs);
      });

  const txPromise = blockstack.transactions.makeRegister(
    name, address, paymentKey, zonefile, zonefileHash);

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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely registered',
          'isNameValid': isNameValid,
          'isNameAvailable': isNameAvailable,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod
        }));
      }
    });
  
  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
 * @zonefileHash (string) the zone file hash to use, if given
 *   (will be used instead of the zonefile)
 */
function update(network: Object, args: Array<string>) {
  const name = args[0];
  let zonefile = args[1];
  const ownerKey = args[2];
  const paymentKey = args[3];
  let zonefileHash = null;
  if (args.length > 4) {
    zonefileHash = args[4];
    zonefile = null;
    console.log(`Using zone file hash ${zonefileHash} instead of zone file`);
  }

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
    name, ownerKey, paymentKey, zonefile, zonefileHash);

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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely updated',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'isInGracePeriod': isInGracePeriod
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
      });
    });
}

/*
 * Generate and optionally send a name-transfer
 * args:
 * @name (string) the name to transfer
 * @address (string) the new owner address
 * @keepZoneFile (boolean) keep the zone file or not
 * @ownerKey (string) the owner private key
 * @paymentKey (string) the payment private key
 */
function transfer(network: Object, args: Array<string>) {
  const name = args[0];
  const address = args[1];
  const keepZoneFile = (args[2].toLowerCase() === 'true');
  const ownerKey = args[3];
  const paymentKey = args[4];
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
    name, address, ownerKey, paymentKey, keepZoneFile);

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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely transferred',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'addressCanReceiveName': addressCanReceiveName,
          'isInGracePeriod': isInGracePeriod
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
 * @zonefileHash (string) OPTINOAL: use the given zonefile hash.  Supercedes zonefile.
 */
function renew(network: Object, args: Array<string>) {
  const name = args[0];
  const ownerKey = args[1];
  const paymentKey = args[2];
  const ownerAddress = getPrivateKeyAddress(network, ownerKey);
  const paymentAddress = getPrivateKeyAddress(network, paymentKey);

  let newAddress = null;
  let zonefile = null;
  let zonefileHash = null;

  if (args.length <= 3) {
    newAddress = getPrivateKeyAddress(network, ownerKey);
  }
  else {
    newAddress = args[3];
  }

  if (args.length <= 5) {
    zonefile = args[4];
  }

  if (args.length <= 6) {
    zonefileHash = args[5];
    zonefile = null;
    console.log(`Using zone file hash ${zonefileHash} instead of zone file`);
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

  const zonefilePromise = new Promise((resolve) => {
    if (!!zonefile) {
      resolve(zonefile);
    } else if (!!zonefileHash) {
      // already have the hash 
      resolve(null);
    } else {
      return network.getNameInfo(name)
        .then((nameInfo) => {
          if (!!nameInfo.zonefile_hash) {
            return network.getZonefile(nameInfo.zonefile_hash)
              .then((zonefileData) => {
                resolve(zonefileData);
              });
          } else {
            // give an empty zonefile 
            resolve(null);
          };
        });
    }
  })
  .catch((e) => {
    console.error(e);
  });

  const txPromise = zonefilePromise.then((zonefileData) => {
    return blockstack.transactions.makeRenewal(
      name, newAddress, ownerKey, paymentKey, zonefileData, zonefileHash);
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
      blockstack.safety.ownsName(name, network.coerceAddress(ownerAddress)),
      newAddress !== null ? blockstack.safety.addressCanReceiveName(
        network.coerceAddress(newAddress)) : true,
    ])
    .then(([isNameValid, ownsName, addressCanReceiveName]) => {
      if (isNameValid && ownsName && addressCanReceiveName) {
        return {'status': true};
      }
      else {
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely renewed',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'addressCanReceiveName': addressCanReceiveName
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safely revoked',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'isInGracePeriod': isInGracePeriod
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Namespace cannot be safely preordered',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceAvailable': isNamespaceAvailable,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate,
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Namespace cannot be safely revealed',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceAvailable': isNamespaceAvailable,
          'paymentBalance': paymentBalance,
          'estimateCost': estimate,
        }));
      }
    });
  
  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
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
          namespaceID, numUTXOs);
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
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Namespace cannot be safely launched',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceReady': isNamespaceReady,
          'isPrivateKeyRevealer': isRevealer,
          'revealerBalance': revealerBalance,
          'estimateCost': estimate
        }));
      }
    });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
      });
    });
}

/*
 * Generate and send a name-import transaction
 * @name (string) the name to import
 * @recipientAddr (string) the recipient of the name
 * @zonefileHash (string) the zone file hash
 * @importKey (string) the key to pay for the import
 */
function nameImport(network: Object, args: Array<string>) {
  const name = args[0];
  const recipientAddr = args[1];
  const zonefileHash = args[2];
  const importKey = args[3];

  const namespaceID = name.split('.').slice(-1);
  const importAddress = getPrivateKeyAddress(network, importKey);

  const txPromise = blockstack.transactions.makeNameImport(
    name, recipientAddr, zonefileHash, importKey);

  const importUTXOsPromise = network.getUTXOs(importAddress);

  const estimatePromise = importUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateNameImport(
          name, recipientAddr, zonefileHash);
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

  const importBalancePromise = importUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all([
      blockstack.safety.namespaceIsReady(namespaceID),
      blockstack.safety.namespaceIsRevealed(namespaceID),
      blockstack.safety.addressCanReceiveName(recipientAddr),
      importBalancePromise,
      estimatePromise
    ])
    .then(([isNamespaceReady, isNamespaceRevealed, addressCanReceive,
            importBalance, estimate]) => {
      if (!isNamespaceReady && isNamespaceRevealed && addressCanReceive &&
          importBalance >= estimate) {
        return {'status': true};
      }
      else {
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Name cannot be safetly imported',
          'isNamespaceReady': isNamespaceReady,
          'isNamespaceRevealed': isNamespaceRevealed,
          'addressCanReceiveName': addressCanReceive,
          'importBalance': importBalance,
          'estimateCost': estimate
        }));
      }
  });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
      });
    });
}


/*
 * Announce a message to subscribed peers by means of an Atlas zone file
 * @messageHash (string) the hash of the already-sent message
 * @senderKey (string) the key that owns the name that the peers have subscribed to
 */
function announce(network: Object, args: Array<string>) {
  const messageHash = args[0];
  const senderKey = args[1];

  const senderAddress = getPrivateKeyAddress(network, senderKey);

  const txPromise = blockstack.transactions.makeAnnounce(
    messageHash, senderKey);

  const senderUTXOsPromise = network.getUTXOs(senderAddress);

  const estimatePromise = senderUTXOsPromise.then((utxos) => {
        const numUTXOs = utxos.length;
        return blockstack.transactions.estimateAnnounce(messageHash)
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

  const senderBalancePromise = senderUTXOsPromise.then((utxos) => {
    return sumUTXOs(utxos);
  });

  const safetyChecksPromise = Promise.all(
     [senderBalancePromise, estimatePromise])
    .then(([senderBalance, estimate]) => {
      if (senderBalance >= estimate) {
        return {'status': true};
      }
      else {
        throw new Error(JSON.stringify({
          'status': false,
          'error': 'Announcement cannot be safely sent',
          'senderBalance': senderBalance,
          'estimateCost': estimate
        }));
      }
  });

  return safetyChecksPromise
    .then((safetyChecksResult) => {
      if (!safetyChecksResult.status) {
        return new Promise((resolve) => resolve(safetyChecksResult));
      }

      if (txOnly) {
        return txPromise;
      }

      return txPromise.then((tx) => {
        return network.broadcastTransaction(tx);
      })
      .then((txidHex) => {
        return txidHex;
      });
    });
}

/*
 * Sign a profile.
 * @path (string) path to the profile
 * @privateKey (string) the owner key
 */
function profileSign(network: Object, args: Array<string>) {
  const profilePath = args[0];
  const privateKey = args[1];
  const profileData = JSON.parse(fs.readFileSync(profilePath).toString());
  return Promise.resolve().then(() => {
    const signedToken = blockstack.signProfileToken(profileData, privateKey);
    const wrappedToken = blockstack.wrapProfileToken(signedToken);
    const tokenRecords = [wrappedToken];
    return JSON.stringify(tokenRecords);
  });
}

/*
 * Verify a profile with an address or public key
 * @path (string) path to the profile
 * @publicKeyOrAddress (string) public key or address
 */
function profileVerify(network: Object, args: Array<string>) {
  const profilePath = args[0];
  let publicKeyOrAddress = args[1];

  // need to coerce mainnet 
  if (publicKeyOrAddress.match(ADDRESS_PATTERN)) {
    publicKeyOrAddress = coerceMainnetAddress(publicKeyOrAddress);
  }
  
  const profileString = fs.readFileSync(profilePath).toString();
  
  return Promise.resolve().then(() => {
    let profileToken = null;
    
    try {
      const profileTokens = JSON.parse(profileString);
      profileToken = profileTokens[0].token;
    }
    catch (e) {
      // might be a raw token 
      profileToken = profileString;
    }

    if (!profileToken) {
      throw new Error(`Data at ${profilePath} does not appear to be a signed profile`);
    }
   
    const profile = blockstack.extractProfile(profileToken, publicKeyOrAddress);
    return JSON.stringify(profile);
  });
}

/*
 * Upload data to a Gaia hub
 * @gaiaHubUrl (string) the base scheme://host:port URL to the Gaia hub
 * @gaiaData (string) the data to upload
 * @privateKey (string) the private key to use to sign the challenge
 */
function gaiaUpload(network: Object,
                    gaiaHubURL: string, 
                    gaiaPath: string,
                    gaiaData: string,
                    privateKey: string) {
  const ownerAddress = getPrivateKeyAddress(network, privateKey);
  const ownerAddressMainnet = coerceMainnetAddress(ownerAddress); 
  return blockstack.connectToGaiaHub(gaiaHubURL, canonicalPrivateKey(privateKey))
    .then((hubConfig) => {
      if (hubConfig.address !== ownerAddressMainnet) {
        throw new Error(`Invalid private key: ${hubConfig.address} != ${ownerAddressMainnet}`);
      }
      if (!hubConfig.url_prefix.startsWith(gaiaHubURL)) {
        throw new Error(`Invalid Gaia hub URL: must match ${hubConfig.url_prefix}`);
      }
      return blockstack.uploadToGaiaHub(gaiaPath, gaiaData, hubConfig);
    });
}

/*
 * Store a signed profile for a name.
 * * verify that the profile was signed by the name's owner address
 * * verify that the private key matches the name's owner address
 *
 * Assumes that the URI records are all Gaia hubs
 *
 * @name (string) name to get the profile
 * @path (string) path to the signed profile token
 * @privateKey (string) owner private key for the name
 */
function profileStore(network: Object, args: Array<string>) {
  const name = args[0];
  const signedProfilePath = args[1];
  const privateKey = args[2];
  const signedProfileData = fs.readFileSync(signedProfilePath).toString();

  const ownerAddress = getPrivateKeyAddress(network, privateKey);
  const ownerAddressMainnet = coerceMainnetAddress(ownerAddress);

  const lookupPromise = network.getNameInfo(name);
  const verifyProfilePromise = profileVerify(network, [signedProfilePath, ownerAddressMainnet]);
    
  return Promise.all([lookupPromise, verifyProfilePromise])
    .then(([nameInfo, verifiedProfile]) => {
      if (network.coerceAddress(nameInfo.address) !== network.coerceAddress(ownerAddress)) {
        throw new Error(`Name owner address ${nameInfo.address} does not 
          match private key address ${ownerAddress}`);
      }
      if (!nameInfo.zonefile) {
        throw new Error(`Could not load zone file for '${name}'`)
      }

      const zonefile = parseZoneFile(nameInfo.zonefile);
      const gaiaProfileUrls = zonefile.uri.map((uriRec) => uriRec.target);
      const gaiaUrls = gaiaProfileUrls.map((gaiaProfileUrl) => {
        const urlInfo = URL.parse(gaiaProfileUrl);
        if (!urlInfo.protocol) {
          return null;
        }
        if (!urlInfo.host) {
          return null;
        }
        if (!urlInfo.path) {
          return null;
        }
        if (!urlInfo.path.endsWith('profile.json')) {
          return null;
        }
        // keep flow happy
        return `${String(urlInfo.protocol)}//${String(urlInfo.host)}`;
      })
      .filter((gaiaUrl) => !!gaiaUrl);

      const uploadPromises = gaiaUrls.map((gaiaUrl) => 
        gaiaUpload(network, gaiaUrl, 'profile.json', signedProfileData, privateKey));

      return Promise.all(uploadPromises)
        .then((publicUrls) => {
          return JSON.stringify({ 'profileUrls': publicUrls });
        });
    });
}

/*
 * Push a zonefile to the Atlas network
 * @zonefileDataOrPath (string) the zonefile data to push, or the path to the data
 */
function zonefilePush(network: Object, args: Array<string>) {
  const zonefileDataOrPath = args[0];
  let zonefileData = null;

  try {
    zonefileData = fs.readFileSync(zonefileDataOrPath);
  } catch(e) {
    zonefileData = zonefileDataOrPath;
  }

  return network.putZonefile(zonefileData)
    .then((result) => {
      return JSON.stringify(result);
    });
}

/*
 * Global set of commands
 */
const COMMANDS = {
  'announce': announce,
  'get_name_blockchain_record': getNameBlockchainRecord,
  'get_name_blockchain_history': getNameHistoryRecord,
  'get_namespace_blockchain_record': getNamespaceBlockchainRecord,
  'lookup': lookup,
  'names': names,
  'name_import': nameImport,
  'namespace_preorder': namespacePreorder,
  'namespace_reveal': namespaceReveal,
  'namespace_ready': namespaceReady,
  'preorder': preorder,
  'price': price,
  'profile_sign': profileSign,
  'profile_store': profileStore,
  'profile_verify': profileVerify,
  'register': register,
  'renew': renew,
  'revoke': revoke,
  'transfer': transfer,
  'update': update,
  'whois': whois,
  'zonefile_push': zonefilePush
};

/*
 * CLI main entry point
 */
export function CLIMain() {
  const argv = process.argv;
  const opts = getCLIOpts(argv);

  const cmdArgs = checkArgs(opts._);
  if (!cmdArgs.success) {
    console.error(cmdArgs.error);
    if (cmdArgs.usage) {
      printUsage();
    }
    process.exit(1);
  }
  else {
    txOnly = opts['x'];
    estimateOnly = opts['e'];
    safetyChecks = !opts['U'];
    const consensusHash = opts['C'];
    const testnet = opts['t'];
    const configPath = opts['c'] ? opts['c'] : 
      (testnet ? DEFAULT_CONFIG_REGTEST_PATH : DEFAULT_CONFIG_PATH);
    const namespaceBurnAddr = opts['B'];
    const feeRate = opts['F'];

    const configData = loadConfig(configPath, testnet);
    let blockstackNetwork = getNetwork(configData, (BLOCKSTACK_TEST || testnet));
    if (BLOCKSTACK_TEST || testnet) {
      // wrap command-line options
      blockstackNetwork = new CLIRegtestNetworkAdapter(
        blockstackNetwork, consensusHash, feeRate, namespaceBurnAddr);
    }

    blockstack.config.network = blockstackNetwork;

    const method = COMMANDS[cmdArgs.command];
    method(blockstackNetwork, cmdArgs.args)
    .then((result) => console.log(result))
    .then(() => process.exit(0))
    .catch((e) => {
       console.error(e.stack);
       console.error(e.message);
       process.exit(1);
     });
  }
}


