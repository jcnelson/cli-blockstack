/* @flow */

const blockstack = require('blockstack');
const jsontokens = require('jsontokens')

import {
  getApplicationKeyInfo
} from './keys';

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

export function makeSignInLink(network: Object,
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

export function makeAuthPage(network: Object,
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
