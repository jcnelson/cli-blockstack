/* @flow */

const blockstack = require('blockstack');
const jsontokens = require('jsontokens');
const URL = require('url');

import {
  canonicalPrivateKey,
  getPrivateKeyAddress,
  checkUrl,
  SafetyError
} from './utils';

/*
 * Connect to Gaia hub.  Make sure we use a mainnet address always, even in test mode
 * (works around a bug in some versions of blockstack.js)
 */
export function gaiaConnect(network: Object, gaiaHubUrl: string, privateKey: string) {
  const addressMainnet = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, `${canonicalPrivateKey(privateKey)}01`))
  const addressMainnetCanonical = network.coerceMainnetAddress(
    getPrivateKeyAddress(network, canonicalPrivateKey(privateKey)))

  return blockstack.connectToGaiaHub(gaiaHubUrl, canonicalPrivateKey(privateKey))
    .then((hubConfig) => {
      // ensure that hubConfig always has a mainnet address, even if we're in testnet
      if (network.coerceMainnetAddress(hubConfig.address) === addressMainnet) {
        hubConfig.address = addressMainnet;
      }
      else if (network.coerceMainnetAddress(hubConfig.address) === addressMainnetCanonical) {
        hubConfig.address = addressMainnetCanonical;
      }
      else {
        throw new Error('Invalid private key: ' +
          `${network.coerceMainnetAddress(hubConfig.address)} is neither ` +
          `${addressMainnet} or ${addressMainnetCanonical}`);
      }
      return hubConfig;
    });
}

/*
 * Upload profile data to a Gaia hub
 * @gaiaHubUrl (string) the base scheme://host:port URL to the Gaia hub
 * @gaiaData (string) the data to upload
 * @privateKey (string) the private key to use to sign the challenge
 */
export function gaiaUploadProfile(network: Object,
                                  gaiaHubURL: string, 
                                  gaiaPath: string,
                                  gaiaData: string,
                                  privateKey: string) {
  return gaiaConnect(network, gaiaHubURL, privateKey)
    .then((hubConfig) => {
      return blockstack.uploadToGaiaHub(gaiaPath, gaiaData, hubConfig);
    });
}

/*
 * Upload profile data to all Gaia hubs, given a zone file
 * @network (object) the network to use
 * @gaiaUrls (array) list of Gaia URLs
 * @gaiaPath (string) the path to the file to store in Gaia
 * @gaiaData (string) the data to store
 * @privateKey (string) the hex-encoded private key
 * @return a promise with {'dataUrls': [urls to the data]}, or {'error': ...}
 */
export function gaiaUploadProfileAll(network: Object, gaiaUrls: Array<string>, gaiaPath: string, 
  gaiaData: string, privateKey: string) : Promise<*> {

  const sanitizedGaiaUrls = gaiaUrls.map((gaiaUrl) => {
    const urlInfo = URL.parse(gaiaUrl);
    if (!urlInfo.protocol) {
      return '';
    }
    if (!urlInfo.host) {
      return '';
    }
    // keep flow happy
    return `${String(urlInfo.protocol)}//${String(urlInfo.host)}`;
  })
  .filter((gaiaUrl) => gaiaUrl.length > 0);

  const uploadPromises = sanitizedGaiaUrls.map((gaiaUrl) => 
    gaiaUploadProfile(network, gaiaUrl, gaiaPath, gaiaData, privateKey));

  return Promise.all(uploadPromises)
    .then((publicUrls) => {
      return { error: null, dataUrls: publicUrls };
    })
    .catch((e) => {
      return { error: `Failed to upload: ${e.message}`, dataUrls: null };
    });
}

/*
 * Make a zone file from a Gaia hub---reach out to the Gaia hub, get its read URL prefix,
 * and generate a zone file with the profile mapped to the Gaia hub.
 *
 * @network (object) the network connection
 * @name (string) the name that owns the zone file
 * @gaiaHubUrl (string) the URL to the gaia hub write endpoint
 * @ownerKey (string) the owner private key
 *
 * Returns a promise that resolves to the zone file with the profile URL
 */
export function makeZoneFileFromGaiaUrl(network: Object, name: string, 
  gaiaHubUrl: string, ownerKey: string) {

  const address = getPrivateKeyAddress(network, ownerKey);
  const mainnetAddress = network.coerceMainnetAddress(address)

  return gaiaConnect(network, gaiaHubUrl, ownerKey)
    .then((hubConfig) => {
      if (!hubConfig.url_prefix) {
        throw new Error('Invalid hub config: no read_url_prefix defined');
      }
      const gaiaReadUrl = hubConfig.url_prefix.replace(/\/+$/, "");
      const profileUrl = `${gaiaReadUrl}/${mainnetAddress}/profile.json`;
      try {
        checkUrl(profileUrl);
      }
      catch(e) {
        throw new SafetyError({
          'status': false,
          'error': e.message,
          'hints': [
            'Make sure the Gaia hub read URL scheme is present and well-formed.',
            `Check the "read_url_prefix" field of ${gaiaHubUrl}/hub_info`
          ],
        });
      }
      return blockstack.makeProfileZoneFile(name, profileUrl);
    });
}
