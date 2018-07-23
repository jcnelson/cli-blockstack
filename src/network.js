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

  constructor(network: blockstack.network.BlockstackNetwork, consensusHash: string | null,
              feeRate: number | null, namespaceBurnAddress: string | null,
              priceToPay: number | null, priceUnits: string | null, 
              receiveFeesPeriod: number | null, gracePeriod: number | null,
              altAPIUrl: string | null, altTransactionBroadcasterUrl: string | null,
              nodeAPIUrl: string | null) {

    const apiUrl = altAPIUrl ? altAPIUrl : network.blockstackAPIUrl;
    const txbUrl = altTransactionBroadcasterUrl ? 
                   altTransactionBroadcasterUrl : 
                   network.broadcastServiceUrl;

    super(apiUrl, txbUrl, network.btc, network.layer1)
    this.consensusHash = consensusHash
    this.feeRate = feeRate
    this.namespaceBurnAddress = namespaceBurnAddress
    this.priceToPay = priceToPay
    this.priceUnits = priceUnits
    this.receiveFeesPeriod = receiveFeesPeriod
    this.gracePeriod = gracePeriod
    this.optAlwaysCoerceAddress = false
    this.nodeAPIUrl = nodeAPIUrl
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

  coerceAddress(address: string) : string {
    // TODO: move to blockstack.js
    const addrInfo = bitcoin.address.fromBase58Check(address)
    const addrHash = addrInfo.hash
    if (addrInfo.version === bitcoin.networks.bitcoin.pubKeyHash ||
        addrInfo.version === bitcoin.networks.testnet.pubKeyHash) {
      // p2pkh address
      return bitcoin.address.toBase58Check(addrHash, this.layer1.pubKeyHash)
    } else if (addrInfo.version === bitcoin.networks.bitcoin.scriptHash ||
            addrInfo.version === bitcoin.networks.testnet.scriptHash) {
      // p2sh address
      return bitcoin.address.toBase58Check(addrHash, this.layer1.scriptHash)
    }
    else {
      throw new Error(`Unknown address version of ${address}`)
    }
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

  getNamePriceV1(fullyQualifiedName: string) : Promise<*> {
    // legacy code path
    return fetch(`${this.blockstackAPIUrl}/v1/prices/names/${fullyQualifiedName}`)
      .then(resp => resp.json())
      .then(resp => resp.name_price)
      .then(namePrice => {
        if (!namePrice || !namePrice.satoshis) {
          throw new Error(
            `Failed to get price for ${fullyQualifiedName}. Does the namespace exist?`)
        }
        const result = {
          units: 'BTC',
          amount: bigi.fromByteArrayUnsigned(String(namePrice.satoshis))
        }
        return result
      })
  }

  getNamespacePriceV1(namespaceID: string) : Promise<*> {
    return fetch(`${this.blockstackAPIUrl}/v1/prices/namespaces/${namespaceID}`)
      .then(resp => resp.json())
      .then(namespacePrice => {
        if (!namespacePrice || !namespacePrice.satoshis) {
          throw new Error(`Failed to get price for ${namespaceID}`)
        }
        const result = {
          units: 'BTC',
          amount: bigi.fromByteArrayUnsigned(String(namespacePrice.satoshis))
        }
        return result
      })
  }

  getNamePriceV2(fullyQualifiedName: string) : Promise<*> {
    return super.getNamePrice(fullyQualifiedName)
      .then((namePrice) => {
        // might be a number, in which case, this is BTC 
        if (typeof namePrice === 'number') {
          const result = {
            units: 'BTC',
            amount: bigi.fromByteArrayUnsigned(String(namePrice))
          };
          return result;
        }
        else {
          return namePrice;
        }
      });
  }

  getNamespacePriceV2(namespaceID: string) : Promise<*> {
    return super.getNamespacePrice(namespaceID)
      .then((namespacePrice) => {
        // might be a number, in which case, this is BTC 
        if (typeof namespacePrice === 'number') {
          const result = {
            units: 'BTC',
            amount: bigi.fromByteArrayUnsigned(String(namespacePrice))
          };
          return result;
        }
        else {
          return namespacePrice;
        }
      });
  }

  getNamePriceCompat(fullyQualifiedName: string) : Promise<*> {
    // handle v1 or v2 
    return Promise.resolve().then(() => {
      return this.getNamePriceV2(fullyQualifiedName)
    })
    .catch(() => {
      return this.getNamePriceV1(fullyQualifiedName)
    })
  }

  getNamespacePriceCompat(namespaceID: string) : Promise<*> {
    // handle v1 or v2 
    return Promise.resolve().then(() => {
      return this.getNamespacePriceV2(namespaceID)
    })
    .catch(() => {
      return this.getNamespacePriceV1(namespaceID)
    })
  }

  getNamePrice(name: string) {
    // override with CLI option 
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }))
    }
    return this.getNamePriceCompat(name)
  }

  getNamespacePrice(namespaceID: string) {
    // override with CLI option 
    if (this.priceUnits && this.priceToPay) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }))
    }
    return this.getNamespacePriceCompat(namespaceID)
  }

  getNamespaceBurnAddress(namespace: string, useCLI: ?boolean = true) {
    // TODO: update getNamespaceBurnAddress() to take an optional receive-fees-period
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

  getZonefile(zonefileHash: string) {
    // mask 404's by returning null
    return super.getZonefile(zonefileHash)
      .then((zonefile) => zonefile)
      .catch((e) => {
        if (e.message === 'Bad response status: 404') {
          // make 404's return null
          return null
        }
        else {
          throw e
        }
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

  getNameHistory(name: string, 
                 startHeight: number | null, 
                 endHeight: number | null) : Promise<*> {

    // TODO: send to blockstack.js 
    let url = `${this.blockstackAPIUrl}/v1/names/${name}/history`
    if (!!startHeight) {
      url += `?start_block=${startHeight}`
    }
    if (!!endHeight) {
      url += `&end_block=${endHeight}`
    }
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

  getAccountStatus(address: string, tokenType: string) : Promise<*> {
    // TODO: send to blockstack.js 
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
      .then(accountStatus => {
        if (accountStatus.error) {
          throw new Error(`Unable to get account status: ${accountStatus}`)
        }

        // coerce all addresses, and convert credit/debit to biginteger
        const res = Object.assign({}, accountStatus, {
          address: this.coerceAddress(accountStatus.address),
          debit_value: bigi.fromByteArrayUnsigned(String(accountStatus.debit_value)),
          credit_value: bigi.fromByteArrayUnsigned(String(accountStatus.credit_value))
        });
        return res;
      })
  }

  getAccountHistoryPage(address: string,
                        startBlockHeight: number,
                        endBlockHeight: number,
                        page: number) : Promise<*> {
    // TODO: send to blockstack.js 
    const url = `${this.blockstackAPIUrl}/v1/accounts/${address}/history?` +
                          `startblock=${startBlockHeight}&endblock=${endBlockHeight}&page=${page}`
    return fetch(url)
      .then(resp => {
        if (resp.status === 404) {
          throw new Error("Account not found")
        } else if (resp.status != 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        } else {
          return resp.json()
        }
      })
      .then((historyList) => {
        if (historyList.error) {
          throw new Error(`Unable to get account history page: ${historyList.error}`)
        }
        // coerse all addresses 
        return historyList.map((histEntry) => {
          histEntry.address = this.coerceAddress(histEntry.address)
          return histEntry
        })
      })
  }

  getAccountAt(address: string, blockHeight: number) : Promise<*> {
    // TODO: send to blockstack.js 
    const url = `${this.blockstackAPIUrl}/v1/accounts/${address}/history/${blockHeight}`
    return fetch(url)
      .then(resp => {
        if (resp.status === 404) {
          throw new Error("Account not found")
        } else if (resp.status != 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        } else {
          return resp.json()
        }
      })
      .then((historyList) => {
        if (historyList.error) {
          throw new Error(`Unable to get historic account state: ${historyList.error}`)
        }
        // coerce all addresses 
        return historyList.map((histEntry) => {
          histEntry.address = this.coerceAddress(histEntry.address)
          return histEntry
        })
      })
  }

  getAccountTokens(address: string) : Promise<*> {
    // TODO: send to blockstack.js 
    return fetch(`${this.blockstackAPIUrl}/v1/accounts/${address}/tokens`)
      .then(resp => {
        if (resp.status === 404) {
          throw new Error("Account not found")
        } else if (resp.status != 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        } else {
          return resp.json()
        }
      })
      .then((tokenList) => {
        if (tokenList.error) {
          throw new Error(`Unable to get token list: ${tokenList.error}`)
        }

        return tokenList
      })
  }

  getAccountBalance(address: string, tokenType: string) : Promise<*> {
    // TODO: send to blockstack.js 
    return fetch(`${this.blockstackAPIUrl}/v1/accounts/${address}/${tokenType}/balance`)
      .then(resp => {
        if (resp.status === 404) {
          // talking to an older blockstack core node without the accounts API
          return Promise.resolve().then(() => bigi.fromByteArrayUnsigned('0'))
        } else if (resp.status != 200) {
          throw new Error(`Bad response status: ${resp.status}`)
        } else {
          return resp.json()
        }
      })
      .then((tokenBalance) => {
        if (tokenBalance.error) {
          throw new Error(`Unable to get account balance: ${tokenBalance.error}`)
        }
        let balance = '0'
        if (tokenBalance && tokenBalance.balance) {
          balance = tokenBalance.balance
        }
        return bigi.fromByteArrayUnsigned(balance)
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
  
