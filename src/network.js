/* @flow */

const blockstack = require('blockstack');
const Promise = require('bluebird');
Promise.onPossiblyUnhandledRejection(function(error){
    throw error;
});

/*
 * Adapter class for regtest that allows us to use data obtained
 * from the CLI.
 */
export class CLIRegtestNetworkAdapter extends blockstack.network.LocalRegtest {
  consensusHash: string | null
  feeRate: number | null
  namespaceBurnAddress: string | null

  constructor(network: blockstack.network.BlockstackNetwork, consensusHash: string | null,
              feeRate: number | null, namespaceBurnAddress: string | null) {

    super(network.blockstackAPIUrl, network.broadcastServiceUrl, network.btc, network.layer1);
    this.consensusHash = consensusHash;
    this.feeRate = feeRate;
    this.namespaceBurnAddress = namespaceBurnAddress
  }

  getFeeRate() : Promise<number> {
    if (this.feeRate) {
      return this.feeRate;
    }
    return super.getFeeRate();
  }

  getConsensusHash() {
    if (this.consensusHash) {
      return new Promise((resolve) => resolve(this.consensusHash));
    }
    return super.getConsensusHash();
  }

  getNamespaceBurnAddress(namespaceID: string) {
    if (this.namespaceBurnAddress) {
      return new Promise((resolve) => resolve(this.namespaceBurnAddress));
    }
    return super.getNamespaceBurnAddress(namespaceID);
  }

  getZonefile(zonefileHash: string) {
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

  putZonefile(zonefileData: string) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    const requestHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    };

    const options = {
      method: 'PUT',
      headers: requestHeaders,
      body: zonefileData
    };

    const url = `${this.blockstackAPIUrl}/v1/zonefiles`;
    return fetch(url, options)
      .then(resp => {
        if (resp.status === 200 || resp.status === 202) {
          return resp.json().then(respJSON => respJSON)
        }
        else {
          throw new Error(`Failed to store zonefile: status code ${resp.status}`);
        }
      });
  }

  getBlockchainNameRecord(name: string) : Promise<*> {
    // TODO: consider moving this to blockstack.js
    const url = `${this.blockstackAPIUrl}/v1/blockchains/bitcoin/${name}`;
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
    if (startHeight !== null) {
      url += `?start_block=${startHeight}`;
    }
    if (endHeight !== null) {
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
  
