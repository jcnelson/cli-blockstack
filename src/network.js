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
              altAPIUrl: string | null, altTransactionBroadcasterUrl: string | null) {

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
  }

  getNamespacePriceV2(namespaceID: string) : Promise<*> {
    return super.getNamespacePrice(namespaceID)
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
    if (this.priceUnits) {
      return new Promise((resolve) => resolve({
        units: String(this.priceUnits),
        amount: bigi.fromByteArrayUnsigned(String(this.priceToPay))
      }))
    }
    return this.getNamePriceCompat(name)
  }

  getNamespacePrice(namespaceID: string) {
    // override with CLI option 
    if (this.priceUnits) {
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
      } else {
        return Promise.all([resp.json(), blockHeight])
      }
    })
    .then(([namespaceInfo, blockHeight]) => {
      let address = '1111111111111111111114oLvT2' // default burn address
      if (namespaceInfo.version === 2) {
        // pay-to-namespace-creator if this namespace is less than $receiveFeesPeriod blocks old
        if (namespaceInfo.reveal_block + this.receiveFeesPeriod > blockHeight) {
          console.log(`${namespaceInfo.reveal_block} + ${this.receiveFeesPeriod} >= ${blockHeight}`)
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

  getBlockchainNameRecord(name: string) : Promise<*> {
    // TODO: send to blockstack.js 
    const url = `${this.blockstackAPIUrl}/v1/blockchains/bitcoin/names/${name}`
    return fetch(url)
      .then(resp => resp.json())
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
      .then(resp => resp.json())
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
        Object.assign({}, accountStatus, {
          address: this.coerceAddress(accountStatus.address),
          debit_value: bigi.fromByteArrayUnsigned(String(accountStatus.debit_value)),
          credit_value: bigi.fromByteArrayUnsigned(String(accountStatus.credit_value))
        })
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
      new blockstack.network.InsightClient(`${configData.utxoServiceUrl}/insight-api`))

    return network
  }
}
  
