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
  gracePeriod: number | null

  constructor(network: blockstack.network.BlockstackNetwork, opts: Object) {
    const optsDefault = {
      consensusHash: null,
      feeRate: null,
      namesspaceBurnAddress: null,
      priceToPay: null,
      priceUnits: null,
      receiveFeesPeriod: null,
      gracePeriod: null,
      altAPIUrl: network.blockstackAPIUrl,
      altTransactionBroadcasterUrl: network.broadcastServiceUrl,
      nodeAPIUrl: null
    }

    opts = Object.assign({}, optsDefault, opts);

    super(opts.altAPIUrl, opts.altTransactionBroadcasterUrl, network.btc, network.layer1)
    this.consensusHash = opts.consensusHash
    this.feeRate = opts.feeRate
    this.namespaceBurnAddress = opts.namespaceBurnAddress
    this.priceToPay = opts.priceToPay
    this.priceUnits = opts.priceUnits
    this.receiveFeesPeriod = opts.receiveFeesPeriod
    this.gracePeriod = opts.gracePeriod
    this.nodeAPIUrl = opts.nodeAPIUrl
    
    this.optAlwaysCoerceAddress = false
  }

  isMainnet() : boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.bitcoin.pubKeyHash
  }

  isTestnet() : boolean {
    return this.layer1.pubKeyHash === bitcoin.networks.testnet.pubKeyHash
  }

  setCoerceMainnetAddress(value: boolean) {
    this.optAlwaysCoerceAddress = value
  }

  coerceMainnetAddress(address: string) : string {
    const addressInfo = bitcoin.address.fromBase58Check(address)
    const addressHash = addressInfo.hash
    const addressVersion = addressInfo.version
    let newVersion = 0

    if (addressVersion === this.layer1.pubKeyHash) {
      newVersion = 0
    }
    else if (addressVersion === this.layer1.scriptHash) {
      newVersion = 5
    }
    return bitcoin.address.toBase58Check(addressHash, newVersion)
  }

  getFeeRate() : Promise<number> {
    if (this.feeRate) {
      // override with CLI option
      return Promise.resolve(this.feeRate)
    }
    if (this.isTestnet()) {
      // in regtest mode 
      return Promise.resolve(Math.floor(0.00001000 * SATOSHIS_PER_BTC))
    }
    return super.getFeeRate()
  }

  getConsensusHash() {
    // override with CLI option
    if (this.consensusHash) {
      return new Promise((resolve) => resolve(this.consensusHash))
    }
    return super.getConsensusHash()
  }

  getGracePeriod() {
    if (this.gracePeriod) {
      return this.gracePeriod
    }
    return super.getGracePeriod()
  }

  getNamePrice(name: string) {
    // override with CLI option 
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }))
    }
    return super.getNamePrice(name)
  }

  getNamespacePrice(namespaceID: string) {
    // override with CLI option 
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }))
    }
    return super.getNamespacePrice(namespaceID)
  }

  getNamespaceBurnAddress(namespace: string, useCLI: ?boolean = true) {
    // override with CLI option
    if (this.namespaceBurnAddress && useCLI) {
      return new Promise((resolve) => resolve(this.namespaceBurnAddress))
    }

    return Promise.all([
      fetch(`${this.blockstackAPIUrl}/v1/namespaces/${namespace}`),
      this.getBlockHeight()
    ])
    .then(([resp, blockHeight]) => {
      if (resp.status === 404) {
        throw new Error(`No such namespace '${namespace}'`)
      } else if (resp.status !== 200) {
        throw new Error(`Bad response status: ${resp.status}`)
      } else {
        return Promise.all([resp.json(), blockHeight])
      }
    })
    .then(([namespaceInfo, blockHeight]) => {
      let address = '1111111111111111111114oLvT2' // default burn address
      if (namespaceInfo.version === 2) {
        // pay-to-namespace-creator if this namespace is less than $receiveFeesPeriod blocks old
        if (namespaceInfo.reveal_block + this.receiveFeesPeriod > blockHeight) {
          address = namespaceInfo.address
        }
      }
      return address
    })
    .then(address => this.coerceAddress(address))
  }

  getNameInfo(name: string) {
    // optionally coerce addresses
    return super.getNameInfo(name)
      .then((nameInfo) => {
        if (this.optAlwaysCoerceAddress) {
          nameInfo = Object.assign(nameInfo, {
            'address': this.coerceMainnetAddress(nameInfo.address)
          })
        }

        return nameInfo
      })
  }

  getBlockchainNameRecordLegacy(name: string) : Promise<*> {
    // legacy code path.
    if (!this.nodeAPIUrl) {
      throw new Error("No indexer URL given.  Pass -I.")
    }

    // this is EVIL code, and I'm a BAD PERSON for writing it.
    // will be removed once the /v1/blockchains/${blockchain}/names/${name} endpoint ships.
    const postData = '<?xml version="1.0"?>' +
        '<methodCall><methodName>get_name_blockchain_record</methodName>' +
        '<params><param><string>' +
        `${name}` +
        '</string></param></params>' +
        '</methodCall>'

    // try and guess which node we're talking to 
    // (reminder: this is EVIL CODE that WILL BE REMOVED as soon as possible)
    return fetch(`${this.nodeAPIUrl}/RPC2`,
               { method: 'POST',
                 body: postData })
      .then((resp) => {
        if (resp.status >= 200 && resp.status <= 299){
          return resp.text();
        }
        else {
          throw new Error(`Bad response code: ${resp.status}`);
        }
      })
      .then((respText) => {
        // response is a single string
        const start = respText.indexOf('<string>') + '<string>'.length
        const stop = respText.indexOf('</string>')
        const dataResp = respText.slice(start, stop);
        let dataJson = null;
        try {
          dataJson = JSON.parse(dataResp);
          if (!dataJson.record) {
            // error response 
            return dataJson
          }
          const nameRecord = dataJson.record;
          if (nameRecord.hasOwnProperty('history')) {
            // don't return history, since this is not expected in the new API
            delete nameRecord.history;
          }
          return nameRecord;
        }
        catch(e) {
          throw new Error('Invalid JSON returned (legacy codepath)');
        }
      });
  }

  getBlockchainNameRecord(name: string) : Promise<*> {
    // TODO: send to blockstack.js, once we can drop the legacy code path 
    const url = `${this.blockstackAPIUrl}/v1/blockchains/bitcoin/names/${name}`
    return fetch(url)
      .then((resp) => {
        if (resp.status !== 200) {
          return this.getBlockchainNameRecordLegacy(name);
        }
        else {
          return resp.json();
        }
      })
      .then((nameInfo) => {
        // coerce all addresses
        let fixedAddresses = {}
        for (let addrAttr of ['address', 'importer_address', 'recipient_address']) {
          if (nameInfo.hasOwnProperty(addrAttr) && nameInfo[addrAttr]) {
            fixedAddresses[addrAttr] = this.coerceAddress(nameInfo[addrAttr])
          }
        }
        return Object.assign(nameInfo, fixedAddresses)
    })
  }

  getNameHistory(name: string, page: number) : Promise<*> { 
    // TODO: send to blockstack.js 
    const url = `${this.blockstackAPIUrl}/v1/names/${name}/history?page=${page}`
    return fetch(url)
      .then((resp) => {
        if (resp.status !== 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        }
        return resp.json();
      })
      .then((historyInfo) => {
        // coerce all addresses 
        let fixedHistory = {}
        for (let historyBlock of Object.keys(historyInfo)) {
          let fixedHistoryList = []
          for (let historyEntry of historyInfo[historyBlock]) {
            let fixedAddresses = {}
            let fixedHistoryEntry = null 
            for (let addrAttr of ['address', 'importer_address', 'recipient_address']) {
              if (historyEntry.hasOwnProperty(addrAttr) && historyEntry[addrAttr]) {
                fixedAddresses[addrAttr] = this.coerceAddress(historyEntry[addrAttr])
              }
            }
            fixedHistoryEntry = Object.assign(historyEntry, fixedAddresses)
            fixedHistoryList.push(fixedHistoryEntry)
          }
          fixedHistory[historyBlock] = fixedHistoryList
        }
        return fixedHistory
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
        { username: 'blockstack', password: 'blockstacksystem' }))

    return network
  } else {
    const network = new blockstack.network.BlockstackNetwork(
      configData.blockstackAPIUrl, configData.broadcastServiceUrl,
      new blockstack.network.BlockchainInfoApi(configData.utxoServiceUrl))

    return network
  }
}
  
