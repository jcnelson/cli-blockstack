/* @flow */

const blockstack = require('blockstack');
const Promise = require('bluebird');
const bigi = require('bigi');
const bitcoin = require('bitcoinjs-lib');

Promise.onPossiblyUnhandledRejection(function(error){
    throw error;
});

const SATOSHIS_PER_BTC = 1e8

/*
 * Adapter class that allows us to use data obtained
 * from the CLI.
 */
export class CLINetworkAdapter extends blockstack.network.BlockstackNetwork {
  consensusHash: string | null
  feeRate: number | null
  namespaceBurnAddress: string | null
  priceToPay: number | null
  priceUnits: string | null

  constructor(network: blockstack.network.BlockstackNetwork, consensusHash: string | null,
              feeRate: number | null, namespaceBurnAddress: string | null,
              priceToPay: number | null, priceUnits: string | null) {

    super(network.blockstackAPIUrl, network.broadcastServiceUrl, network.btc, network.layer1);
    this.consensusHash = consensusHash;
    this.feeRate = feeRate;
    this.namespaceBurnAddress = namespaceBurnAddress
    this.priceToPay = priceToPay
    this.priceUnits = priceUnits
  }

  isMainnet() : boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.bitcoin.pubKeyHash;
  }

  isTestnet() : boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.testnet.pubKeyHash;
  }

  coerceAddress(address: string) : string {
    // TODO: move to blockstack.js
    const addrInfo = bitcoin.address.fromBase58Check(address);
    const addrHash = addrInfo.hash;
    if (addrInfo.version === bitcoin.networks.bitcoin.pubKeyHash ||
        addrInfo.version === bitcoin.networks.testnet.pubKeyHash) {
      // p2pkh address
      return bitcoin.address.toBase58Check(addrHash, this.layer1.pubKeyHash);
    } else if (addrInfo.version === bitcoin.networks.bitcoin.scriptHash ||
            addrInfo.version === bitcoin.networks.testnet.scriptHash) {
      // p2sh address
      return bitcoin.address.toBase58Check(addrHash, this.layer1.scriptHash);
    }
    else {
      throw new Error(`Unknown address version of ${address}`);
    }
  }

  getFeeRate() : Promise<number> {
    if (this.feeRate) {
      // override with CLI option
      return this.feeRate;
    }
    if (this.isTestnet()) {
      // in regtest mode 
      return Promise.resolve(Math.floor(0.00001000 * SATOSHIS_PER_BTC))
    }
    return super.getFeeRate();
  }

  getConsensusHash() {
    // override with CLI option
    if (this.consensusHash) {
      return new Promise((resolve) => resolve(this.consensusHash));
    }
    return super.getConsensusHash();
  }

  getNamePriceV1(fullyQualifiedName: string) : Promise<*> {
    // fall back to blockstack.js
    return super.getNamePrice(fullyQualifiedName);
  }

  getNamespacePriceV1(namespaceID: string) : Promise<*> {
    // fall back to blockstack.js 
    return super.getNamespacePrice(namespaceID);
  }

  getNamePriceV2(fullyQualifiedName: string) : Promise<*> {
    return fetch(`${this.blockstackAPIUrl}/v2/prices/names/${fullyQualifiedName}`)
      .then(resp => resp.json())
      .then(resp => resp.name_price)
      .then(namePrice => {
        if (!namePrice) {
          throw new Error(
            `Failed to get price for ${fullyQualifiedName}. Does the namespace exist?`)
        }
        const result = {
          units: namePrice.units,
          amount: bigi.fromByteArrayUnsigned(namePrice.amount)
        };
        return result
      })
  }

  getNamespacePriceV2(namespaceID: string) : Promise<*> {
    return fetch(`${this.blockstackAPIUrl}/v2/prices/namespaces/${namespaceID}`)
      .then(resp => resp.json())
      .then(namespacePrice => {
        if (!namespacePrice) {
          throw new Error(`Failed to get price for ${namespaceID}`)
        }
        const result = {
          units: namespacePrice.units,
          amount: bigi.fromByteArrayUnsigned(namespacePrice.amount)
        };
        return result
      })
  }

  getNamePriceCompat(fullyQualifiedName: string) : Promise<*> {
    // handle v1 or v2 
    return Promise.resolve().then(() => {
      return this.getNamePriceV2(fullyQualifiedName);
    })
    .catch(() => {
      return this.getNamePriceV1(fullyQualifiedName)
        .then((namePriceSatoshis) => {
          if (!namePriceSatoshis) {
            throw new Error(`Failed to get price for ${fullyQualifiedName}`);
          }
          return {
            units: 'BTC',
            amount: bigi.fromByteArrayUnsigned(String(namePriceSatoshis))
          };
        });
    });
  }

  getNamespacePriceCompat(namespaceID: string) : Promise<*> {
    // handle v1 or v2 
    return Promise.resolve().then(() => {
      return this.getNamespacePriceV2(namespaceID);
    })
    .catch(() => {
      return this.getNamespacePriceV1(namespaceID)
        .then((namespacePriceSatoshis) => {
          if (!namespacePriceSatoshis) {
            throw new Error(`Failed to get price for ${namespaceID}`);
          }
          return {
            units: 'BTC',
            amount: bigi.fromByteArrayUnsigned(String(namespacePriceSatoshis))
          };
        });
    });
  }

  getNamePrice(name: string) {
    // override with CLI option 
    if (this.priceUnits) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }));
    }
    return this.getNamePriceCompat(name);
  }

  getNamespacePrice(namespaceID: string) {
    // override with CLI option 
    if (this.priceUnits) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }));
    }
    return this.getNamespacePriceCompat(namespaceID);
  }

  getNamespaceBurnAddress(namespaceID: string) {
    // override with CLI option
    if (this.namespaceBurnAddress) {
      return new Promise((resolve) => resolve(this.namespaceBurnAddress));
    }
    return super.getNamespaceBurnAddress(namespaceID);
  }

  getZonefile(zonefileHash: string) {
    // mask 404's by returning null
    return super.getZonefile(zonefileHash)
      .then((zonefile) => zonefile)
      .catch((e) => {
        if (e.message === 'Bad response status: 404') {
          // make 404's return null
          return null;
        }
        else {
          throw e;
        }
      });
  }

  getBlockchainNameRecord(name: string) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    const url = `${this.blockstackAPIUrl}/v1/blockchains/bitcoin/names/${name}`;
    return fetch(url)
      .then(resp => resp.json())
      .then((nameInfo) => {
        // coerce all addresses
        let fixedAddresses = {};
        for (let addrAttr of ['address', 'importer_address', 'recipient_address']) {
          if (nameInfo.hasOwnProperty(addrAttr) && nameInfo[addrAttr]) {
            fixedAddresses[addrAttr] = this.coerceAddress(nameInfo[addrAttr]);
          }
        }
        return Object.assign(nameInfo, fixedAddresses);
    });
  }

  getNameHistory(name: string, 
                 startHeight: number | null, 
                 endHeight: number | null) : Promise<*> {

    // TODO: consider moving this to blockstack.js
    let url = `${this.blockstackAPIUrl}/v1/names/${name}/history`;
    if (!!startHeight) {
      url += `?start_block=${startHeight}`;
    }
    if (!!endHeight) {
      url += `&end_block=${endHeight}`;
    }
    return fetch(url)
      .then(resp => resp.json())
      .then((historyInfo) => {
        // coerce all addresses 
        let fixedHistory = {};
        for (let historyBlock of Object.keys(historyInfo)) {
          let fixedHistoryList = []
          for (let historyEntry of historyInfo[historyBlock]) {
            let fixedAddresses = {};
            let fixedHistoryEntry = null; 
            for (let addrAttr of ['address', 'importer_address', 'recipient_address']) {
              if (historyEntry.hasOwnProperty(addrAttr) && historyEntry[addrAttr]) {
                fixedAddresses[addrAttr] = this.coerceAddress(historyEntry[addrAttr]);
              }
            }
            fixedHistoryEntry = Object.assign(historyEntry, fixedAddresses);
            fixedHistoryList.push(fixedHistoryEntry);
          }
          fixedHistory[historyBlock] = fixedHistoryList;
        }
        return fixedHistory;
      });
  }

  getAccountStatus(address: string, tokenType: string) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    return fetch(`${this.blockstackAPIUrl}/v1/accounts/${address}/${tokenType}/status`)
      .then(resp => {
        if (resp.status === 404) {
          throw new Error('Account not found')
        } else if (resp.status !== 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        } else {
          return resp.json()
        }
      })
      .then(accountStatus => 
        // coerce all addresses, and convert credit/debit to biginteger
        Object.assign({}, accountStatus, {
          address: this.coerceAddress(accountStatus.address),
          debit_value: bigi.fromByteArrayUnsigned(String(accountStatus.debit_value)),
          credit_value: bigi.fromByteArrayUnsigned(String(accountStatus.credit_value))
        })
      )
  }

  getAccountHistoryPage(address: string,
                        startBlockHeight: number,
                        endBlockHeight: number,
                        page: number) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    const url = `${this.blockstackAPIUrl}/v1/accounts/${address}/history?` +
                          `startblock=${startBlockHeight}&endblock=${endBlockHeight}&page=${page}`;
    return fetch(url)
      .then(resp => resp.json())
      .then((historyList) => {
        // coerse all addresses 
        return historyList.map((histEntry) => {
          histEntry.address = this.coerceAddress(histEntry.address);
          return histEntry;
        });
      });
  }

  getAccountAt(address: string, blockHeight: number) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    const url = `${this.blockstackAPIUrl}/v1/accounts/${address}/history/${blockHeight}`;
    return fetch(url)
      .then(resp => resp.json())
      .then((historyList) => {
        // coerce all addresses 
        return historyList.map((histEntry) => {
          histEntry.address = this.coerceAddress(histEntry.address);
          return histEntry;
        });
      });
  }

  getAccountTokens(address: string) : Promise<*> {
    // TODO: send to blockstack.js 
    return fetch(`${this.blockstackAPIUrl}/v1/accounts/${address}/tokens`)
      .then(resp => {
        if (resp.status === 200) {
          return resp.json().then(tokenList => tokenList.tokens)
        } else {
          throw new Error(`Bad response status: ${resp.status}`)
        }
      })
  }

  getAccountBalance(address: string, tokenType: string) : Promise<*> {
    // TODO: send to blockstack.js 
    return fetch(`${this.blockstackAPIUrl}/v1/accounts/${address}/${tokenType}/balance`)
      .then((resp) => {
        if (resp.status === 200) {
          return resp.json()
            .then((tokenBalance) => bigi.fromByteArrayUnsigned(tokenBalance.balance))
        } else if (resp.status === 404) {
          // talking to an older blockstack core node without the accounts API
          return Promise.resolve().then(() => bigi.fromByteArrayUnsigned('0'))
        } else {
          throw new Error(`Bad response status: ${resp.status}`)
        }
      })
  }
}

/*
 * Instantiate a network using settings from the config file.
 */
export function getNetwork(configData: Object, regTest: boolean) 
  : blockstack.network.BlockstackNetwork {
  if (regTest) {
    const network = new blockstack.network.LocalRegtest(
      configData.blockstackAPIUrl, configData.broadcastServiceUrl, 
      new blockstack.network.BitcoindAPI(configData.utxoServiceUrl,
        { username: 'blockstack', password: 'blockstacksystem' }));

    return network;
  } else {
    const network = new blockstack.network.BlockstackNetwork(
      configData.blockstackAPIUrl, configData.broadcastServiceUrl,
      new blockstack.network.BlockchainInfoApi(configData.utxoServiceUrl));

    return network;
  }
}
  
