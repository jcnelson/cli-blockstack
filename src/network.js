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
  
