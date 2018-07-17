/* @flow */

const blockstack = require('blockstack');
const jsontokens = require('jsontokens')
const express = require('express')

import {
  gaiaConnect,
  gaiaUploadProfileAll
} from './data';

import {
  getApplicationKeyInfo,
  getOwnerKeyInfo
} from './keys';

import {
  nameLookup,
  makeProfileJWT
} from './utils';

import { 
  type GaiaHubConfig
} from 'blockstack';

export const SIGNIN_HEADER = '<html><head></head></body><h2>Blockstack CLI Sign-in</h2><br>'
export const SIGNIN_FMT = '<p><a href="{authRedirect}">{blockstackID}</a> ({idAddress})</p>'
export const SIGNIN_FOOTER = '</body></html>'

export type NamedIdentityType = {
  name: string,
  idAddress: string,
  privateKey: string,
  index: number,
  profile: ?Object,
  profileUrl: string,
  gaiaConnection: GaiaHubConfig
};

/*
 * Make a sign-in link
 */
function makeSignInLink(network: Object,
                        authPort: number,
                        mnemonic: string,
                        authRequest: Object,
                        hubUrl: string,
                        id: NamedIdentityType) : string {
  
  const appOrigin = authRequest.domain_name;
  const appKeyInfo = getApplicationKeyInfo(network, mnemonic, id.idAddress, appOrigin, id.index);
  const appPrivateKey = appKeyInfo.keyInfo.privateKey === 'TODO' ?
                        appKeyInfo.legacyKeyInfo.privateKey :
                        appKeyInfo.keyInfo.privateKey;

  const authResponseTmp = blockstack.makeAuthResponse(
    id.privateKey,
    id.profile,
    id.name,
    { email: null, profileUrl: id.profileUrl },
    null,
    appPrivateKey,
    undefined,
    authRequest.public_keys[0],
    hubUrl,
    blockstack.config.network.blockstackAPIUrl
  );

  // pass along some helpful data from the authRequest
  const authResponsePayload = jsontokens.decodeToken(authResponseTmp).payload;
  authResponsePayload.metadata = {
    appOrigin: appOrigin,
    redirect_uri: authRequest.redirect_uri,
    scopes: authRequest.scopes
    // fill in more CLI-specific fields here
  };

  const tokenSigner = new jsontokens.TokenSigner('ES256k', id.privateKey);
  const authResponse = tokenSigner.sign(authResponsePayload);
  return blockstack.updateQueryStringParameter(
    `http://localhost:${authPort}/signin`, 'authResponse', authResponse);
}

/*
 * Make the sign-in page
 */
function makeAuthPage(network: Object,
                      authPort: number,
                      mnemonic: string,
                      hubUrl: string,
                      manifest: Object,
                      authRequest: Object,
                      ids: Array<NamedIdentityType>) : string {

  let signinBody = SIGNIN_HEADER;

  for (let i = 0; i < ids.length; i++) {
    const signinEntry = SIGNIN_FMT
      .replace(/{authRedirect}/, makeSignInLink(
        network,
        authPort,
        mnemonic,
        authRequest,
        hubUrl,
        ids[i]))
      .replace(/{blockstackID}/, ids[i].name)
      .replace(/{idAddress}/, ids[i].idAddress);

    signinBody = `${signinBody}${signinEntry}`;
  }

  signinBody = `${signinBody}${SIGNIN_FOOTER}`;
  return signinBody;
}


/*
 * Find all identity addresses that have names attached to them.
 * Fills in identities.
 */
function loadNamedIdentitiesLoop(network: Object, 
                                 mnemonic: string, 
                                 index: number, 
                                 identities: Array<NamedIdentityType>) {
  const ret = [];

  // 65536 is a ridiculously huge number
  const keyInfo = getOwnerKeyInfo(network, mnemonic, index);
  return network.getNamesOwned(keyInfo.idAddress.slice(3))
    .then((nameList) => {
      if (nameList.length === 0) {
        // out of names 
        return identities;
      }
      for (let i = 0; i < nameList.length; i++) {
        identities.push({
          name: nameList[i],
          idAddress: keyInfo.idAddress,
          privateKey: keyInfo.privateKey,
          index: index,
          profile: null,
          profileUrl: '',
          gaiaConnection: undefined
        });
      }
      return loadNamedIdentitiesLoop(network, mnemonic, index + 1, identities);
    });
}

/*
 * Load all named identities for a mnemonic.
 * Keep loading until we find an ID-address that does not have a name.
 */
export function loadNamedIdentities(network: Object, mnemonic: string) 
  : Promise<Array<NamedIdentityType>> {
  return loadNamedIdentitiesLoop(network, mnemonic, 0, []);
}

/*
 * Send a JSON HTTP response
 */
function sendJSON(res: express.response, data: Object, statusCode: number) {
  res.writeHead(statusCode, {'Content-Type' : 'application/json'})
  res.write(JSON.stringify(data))
  res.end()
}

/*
 * Get all of a 12-word phrase's identities, profiles, and Gaia connections.
 * Returns a Promise to an Array of NamedIdentityType instances
 */
export function getIdentityInfo(network: Object, mnemonic: string, gaiaHubUrl: string) 
  : Promise<Array<NamedIdentityType>> {

  let identities = [];
  let gaiaConnections = [];
  network.setCoerceMainnetAddress(true);    // for lookups in regtest
  
  // load up all of our identity addresses, profiles, profile URLs, and Gaia connections
  const identitiesPromise = loadNamedIdentities(network, mnemonic)
    .then((ids) => {
      const profilePromises = [];
      for (let i = 0; i < ids.length; i++) {
        const profilePromise = nameLookup(network, ids[i].name)
          .catch(() => null);

        profilePromises.push(profilePromise);
      }

      identities = ids;
      return Promise.all(profilePromises);
    })
    .then((profileDatas) => {
      network.setCoerceMainnetAddress(false);
      profileDatas = profileDatas.filter((p) => p !== null && p !== undefined);

      for (let i = 0; i < profileDatas.length; i++) {
        if (profileDatas[i].hasOwnProperty('error') && profileDatas[i].error) {
          // no data for this name 
          identities[i].profile = {};
          identities[i].profileUrl = '';
        }
        else {
          identities[i].profile = profileDatas[i].profile;
          identities[i].profileUrl = profileDatas[i].profileUrl;
        }
      }

      // ignore identities with no data
      identities = identities.filter((id) => id.profileUrl);
      return identities;
    })
    .then((ids) => {
      // connect to all Gaia hubs
      const gaiaConnectionPromises = [];
      for (let i = 0; i < ids.length; i++) {
        const gaiaPromise = gaiaConnect(network, gaiaHubUrl, ids[i].privateKey);
        gaiaConnectionPromises.push(gaiaPromise);
      }

      return Promise.all(gaiaConnectionPromises);
    })
    .then((connections) => {
      network.setCoerceMainnetAddress(false);
      gaiaConnections = connections;

      for (let i = 0; i < connections.length; i++) {
        identities[i].gaiaConnection = connections[i];
      }

      return identities;
    });

  return identitiesPromise;
}


/*
 * Handle GET /auth?authRequest=...
 * If the authRequest is verifiable and well-formed, and if we can fetch the application
 * manifest, then we can render an auth page to the user.
 * Serves back the sign-in page on success.
 * Serves back an error page on error.
 * Returns a Promise that resolves to nothing.
 */
export function handleAuth(network: Object, identities: Array<NamedIdentityType>,
                           mnemonic: string, gaiaHubUrl: string, port: number, 
                           req: express.request, res: express.response) : Promise<*> {

  const authToken = req.query.authRequest;
  if (!authToken) {
     return Promise.resolve().then(() => {
       sendJSON(res, { error: 'No authRequest given' }, 400);
     });
  }
 
  let errorMsg;
  return Promise.resolve().then(() => {
      errorMsg = 'Unable to verify authentication token';
      return blockstack.verifyAuthRequest(authToken);
    })
    .then((valid) => {
      if (!valid) {
        errorMsg = 'Invalid authentication token: could not verify';
        throw new Error(errorMsg);
      }
      errorMsg = 'Unable to fetch app manifest';
      return blockstack.fetchAppManifest(authToken);
    })
    .then((appManifest) => {
      const decodedAuthToken = jsontokens.decodeToken(authToken);
      const decodedAuthPayload = decodedAuthToken.payload;
      if (!decodedAuthPayload) {
        errorMsg = 'Invalid authentication token: no payload';
        throw new Error(errorMsg);
      }

      // make sign-in page
      const authPage = makeAuthPage(
        network, port, mnemonic, gaiaHubUrl, appManifest, decodedAuthPayload, identities);

      res.writeHead(200, {'Content-Type': 'text/html', 'Content-Length': authPage.length});
      res.write(authPage);
      res.end();
      return;
    })
    .catch((e) => {
      console.log(e);
      console.log(errorMsg)
      sendJSON(res, { error: `Unable to authenticate app request: ${errorMsg}` }, 400);
      return;
    });
}

/*
 * Update a named identity's profile with new app data, if necessary.
 * Indicates whether or not the profile was changed.
 */
function updateProfileApps(id: NamedIdentityType, appOrigin: string) 
  : { profile: Object, changed: boolean } {

  let profile = id.profile;
  let needProfileUpdate = false;

  if (!profile) {
    // instantiate 
    console.log(`Instantiating profile for ${id.name}`);
    needProfileUpdate = true;
    profile = {
      'type': '@Person',
      'account': [],
      'apps': {},
    };
  }

  // do we need to update the Gaia hub read URL in the profile?
  if (profile.apps === null || profile.apps === undefined) {
    needProfileUpdate = true;

    console.log(`Adding multi-reader Gaia links to profile for ${id.name}`);
    profile.apps = {};
  }

  if (!profile.apps.hasOwnProperty(appOrigin) || !profile.apps[appOrigin]) {
    needProfileUpdate = true;
    console.log(`Setting Gaia read URL ${id.gaiaConnection.url_prefix} for ${appOrigin} ` +
      `in profile for ${id.name}`);

    profile.apps[appOrigin] = id.gaiaConnection.url_prefix;
  }
  else if (profile.apps[appOrigin] !== id.gaiaConnection.url_prefix) {
    needProfileUpdate = true;
    console.log(`Overriding Gaia read URL for ${appOrigin} from ${profile.apps[appOrigin]} ` +
      `to ${id.gaiaConnection.url_prefix} in profile for ${id.name}`);

    profile.apps[appOrigin] = id.gaiaConnection.url_prefix;
  }

  return { profile, changed: needProfileUpdate };
}


/*
 * Handle GET /signin?authResponse=...
 * Takes an authResponse from the page generated on GET /auth?authRequest=....,
 * verifies it, updates the name's profile's app's entry with the latest Gaia
 * hub information (if necessary), and redirects the user back to the application.
 *
 * Redirects the user on success.
 * Sends the user an error page on failure.
 * Returns a Promise that resolves to nothing.
 */
export function handleSignIn(network: Object, identities: Array<NamedIdentityType>,
                             gaiaHubUrl: string, req: express.request, res: express.response)
  : Promise<*> {
  
  const authResponse = req.query.authResponse;
  if (!authResponse) {
    return Promise.resolve().then(() => {
      sendJSON(res, { error: 'No authResponse given' }, 400);
    });
  }
  const nameLookupUrl = `${network.blockstackAPIUrl}/v1/names/`;

  let errorMsg;
  let errorStatusCode = 400;
  let authResponsePayload;
    
  let id = null;
  let appOrigin = null;
  let redirectUri = null;
  let scopes = [];

  return Promise.resolve().then(() => {
    return blockstack.verifyAuthResponse(authResponse, nameLookupUrl);
  })
  .then((valid) => {
    if (!valid) {
      errorMsg = 'Unable to verify authResponse token';
      throw new Error(errorMsg);
    }

    const authResponseToken = jsontokens.decodeToken(authResponse);
    authResponsePayload = authResponseToken.payload;

    // find name and profile we're signing in as
    for (let i = 0; i < identities.length; i++) {
      if (identities[i].name === authResponsePayload.username) {
        id = identities[i];

        appOrigin = authResponsePayload.metadata.appOrigin;
        redirectUri = authResponsePayload.metadata.redirect_uri;
        scopes = authResponsePayload.metadata.scopes;

        console.log(`App ${appOrigin} requests scopes ${JSON.stringify(scopes)}`);
        break;
      }
    }

    if (!id || !appOrigin || !redirectUri) {
      errorMsg = 'Auth response was not generated by this authenticator';
      throw new Error(errorMsg);
    }
    
    const newProfileData = updateProfileApps(id, appOrigin);
    const profile = newProfileData.profile;
    const needProfileUpdate = newProfileData.changed && scopes.includes('store_write');

    // sign and replicate new profile if we need to.
    // otherwise do nothing 
    if (needProfileUpdate) {
      console.log(`Upload new profile to ${gaiaHubUrl}`);
      const profileJWT = makeProfileJWT(profile, id.privateKey);
      return gaiaUploadProfileAll(
        network, [gaiaHubUrl], 'profile.json', profileJWT, id.privateKey);
    }
    else {
      console.log(`Gaia read URL for ${appOrigin} is ${profile.apps[appOrigin]}`);
      return { dataUrls: [], error: null };
    }
  })
  .then((gaiaUrls) => {
    if (gaiaUrls.hasOwnProperty('error') && gaiaUrls.error) {
      errorMsg = `Failed to upload new profile: ${gaiaUrls.error}`;
      errorStatusCode = 502;
      throw new Error(errorMsg);
    }

    // success!
    // redirect to application
    const appUri = blockstack.updateQueryStringParameter(redirectUri, 'authResponse', authResponse); 
    res.writeHead(302, {'Location': appUri});
    res.end();
    return;
  })
  .catch((e) => {
    console.log(e);
    console.log(errorMsg)
    sendJSON(res, { error: `Unable to process signin request: ${errorMsg}` }, errorStatusCode);
    return;
  });
}
