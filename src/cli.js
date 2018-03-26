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

import {
  getCLIOpts,
  printUsage,
  checkArgs,
  loadConfig,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CONFIG_REGTEST_PATH 
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

  const zonefilePromise = new Promise((resolve) => {
    if (!!zonefile) {
      resolve(zonefile);
    } else {
      return network.getNameInfo(name)
        .then((nameInfo) => {
          if (!!nameInfo.zonefile_hash) {
            return network.getZonefile(nameInfo.value_hash)
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
      name, newAddress, ownerKey, paymentKey, zonefileData);
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
        return {
          'status': false,
          'error': 'Name cannot be safely revoked',
          'isNameValid': isNameValid,
          'ownsName': ownsName,
          'isInGracePeriod': isInGracePeriod
        };
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
        return {
          'status': false,
          'error': 'Namespace cannot be safely launched',
          'isNamespaceValid': isNamespaceValid,
          'isNamespaceReady': isNamespaceReady,
          'isPrivateKeyRevealer': isRevealer,
          'revealerBalance': revealerBalance,
          'estimateCost': estimate
        };
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
       console.error(e);
     });
  }
}


