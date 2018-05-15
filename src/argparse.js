/* @flow */

const Ajv = require('ajv');
const process = require('process');

import os from 'os'
import fs from 'fs'

export const NAME_PATTERN = 
  '^([0-9a-z_.+-]{3,37})$'

export const NAMESPACE_PATTERN = 
  '^([0-9a-z_-]{1,19})$'

export const ADDRESS_CHARS = 
  '[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,35}';

export const ADDRESS_PATTERN = `^(${ADDRESS_CHARS})$`;

export const ID_ADDRESS_PATTERN = `^ID-${ADDRESS_CHARS}$`;

export const PRIVATE_KEY_PATTERN = 
  '^([0-9a-f]{64,66})$'

export const PUBLIC_KEY_PATTERN = 
  '^([0-9a-f]{66,130})$'

export const INT_PATTERN = '^-?[0-9]+$'

export const ZONEFILE_HASH_PATTERN = '^([0-9a-f]{40})$'

export const URL_PATTERN = "^http[s]?://.+$"

export const SUBDOMAIN_PATTERN =
  '^([0-9a-z_+-]{1,37})\.([0-9a-z_.+-]{3,37})$'

export const TXID_PATTERN = 
  '^([0-9a-f]{64})$'

const CONFIG_DEFAULTS = {
  blockstackAPIUrl: 'https://core.blockstack.org',
  broadcastServiceUrl: 'https://broadcast.blockstack.org',
  utxoServiceUrl: 'https://blockchain.info'
};

const CONFIG_REGTEST_DEFAULTS = {
  blockstackAPIUrl: 'http://localhost:16268',
  broadcastServiceUrl: 'http://localhost:16269',
  utxoServiceUrl: 'http://localhost:18332'
};

const PUBLIC_TESTNET_HOST = 'testnet.blockstack.org';
// const PUBLIC_TESTNET_HOST = '127.0.0.1';

const CONFIG_TESTNET_DEFAULTS = {
  blockstackAPIUrl: `http://${PUBLIC_TESTNET_HOST}:16268`,
  broadcastServiceUrl: `http://${PUBLIC_TESTNET_HOST}:16269`,
  utxoServiceUrl: `http://${PUBLIC_TESTNET_HOST}:18332`
};

export const DEFAULT_CONFIG_PATH = '~/.blockstack-cli.conf'
export const DEFAULT_CONFIG_REGTEST_PATH = '~/.blockstack-cli-regtest.conf'
export const DEFAULT_CONFIG_TESTNET_PATH = '~/.blockstack-cli-testnet.conf'

// CLI usage
const CLI_ARGS = {
  type: 'object',
  properties: {
    announce: {
      type: "array",
      items: [
        {
          name: 'message_hash',
          type: "string",
          realtype: 'zonefile_hash',
          pattern: ZONEFILE_HASH_PATTERN,
        },
        {
          name: 'owner_key',
          type: "string",
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 2,
      maxItems: 2,
      help: 'Broadcast a message on the blockchain for subscribers to read.  ' +
      'The MESSAGE_HASH argument must be the hash of a previously-announced zone file.  ' +
      'The OWNER_KEY used to sign the transaction must correspond to the Blockstack ID ' +
      'to which other users have already subscribed.',
      group: 'Peer Services'
    },
    balance: {
      type: "array",
      items: [ 
        {
          name: 'address',
          type: "string",
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        }
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Query the balance of an account.  Returns the balances of each kind of token ' +
      'that the account owns.  The balances will be in the *smallest possible units* of the ' +
      'token (i.e. satoshis for BTC, microStacks for Stacks, etc.).',
      group: 'Account Management',
    },
    get_account_history: {
      type: "array",
      items: [
        {
          name: 'address',
          type: "string",
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          name: 'startblock',
          type: "string",
          realtype: "integer",
          pattern: "^[0-9]+$",
        },
        {
          name: 'endblock',
          type: "string",
          realtype: "integer",
          pattern: "^[0-9]+$",
        },
        {
          name: 'page',
          type: "string",
          realtype: "integer",
          pattern: "^[0-9]+$",
        },
      ],
      minItems: 4,
      maxItems: 4,
      help: 'Query the history of account debits and credits over a given block range.  ' +
      'Returns the history one page at a time.  An empty result indicates that the page ' +
      'number has exceeded the number of historic operations in the given block range.',
      group: 'Account Management',
    },
    get_account_at: {
      type: "array",
      items: [
        {
          name: 'address',
          type: "string",
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          name: 'blocknumber',
          type: "string",
          realtype: 'integer',
          pattern: "^[0-9]+$",
        },
      ],
      minItems: 2,
      maxItems: 2,
      help: 'Query the list of token debits and credits on a given address that occurred ' +
      'at a particular block height.  Does not include BTC debits and credits.',
      group: 'Account Management',
    },
    get_address: {
      type: 'array',
      items: [
        {
          name: 'private_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        }
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the address of a private key.',
      group: 'Key Management',
    },
    get_blockchain_record: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: `^${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the low-level blockchain-hosted state for a Blockstack ID.  This command ' +
      'is used mainly for debugging and diagnostics.  You should not rely on it to be stable.',
      group: 'Querying Blockstack IDs'
    },
    get_blockchain_history: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the low-level blockchain-hosted history of operations on a Blocktack ID.  ' +
      'This command is used mainly for debugging and diagnostics, and is not guaranteed to ' +
      'be stable across releases.',
      group: 'Querying Blockstack IDs',
    },
    get_confirmations: {
      type: "array",
      items: [
        {
          name: 'txid',
          type: 'string',
          realtype: 'transaction_id',
          pattern: TXID_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the number of confirmations for a transaction.',
      group: 'Peer Services',
    },
    get_namespace_blockchain_record: {
      type: "array",
      items: [
        {
          name: 'namespace_id',
          type: "string",
          realtype: 'namespace_id',
          pattern: NAMESPACE_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the low-level blockchain-hosted state for a Blockstack namespace.  This command ' +
      'is used mainly for debugging and diagnostics, and is not guaranteed to be stable across ' +
      'releases.',
      group: 'Namespace Operations',
    },
    get_owner_keys: {
      type: "array",
      items: [
        {
          name: 'backup_phrase',
          type: "string",
          realtype: 'backup_phrase',
        },
        {
          name: 'index',
          type: "string",
          realtype: 'integer',
          pattern: "^[0-9]+$",
        }
      ],
      minItems: 1,
      maxItems: 2,
      help: 'Get the list of owner private keys and ID-addresses from a 12-word backup phrase.  ' +
      'Pass non-zero values for INDEX to generate the sequence of ID-addresses that can be used ' +
      'to own Blockstack IDs.',
      group: 'Key Management',
    },
    get_payment_key: {
      type: "array",
      items: [
        {
          name: 'backup_phrase',
          type: "string",
          realtype: '12_words',
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the payment private key from a 12-word backup phrase.',
      group: 'Key Management',
    },
    get_zonefile: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the current zone file for a Blockstack ID',
      group: 'Peer Services',
    },
    help: {
      type: 'array',
      items: [
        {
          name: 'command',
          type: 'string',
          realtype: 'command',
        },
      ],
      minItems: 0,
      maxItems: 1,
      help: 'Get the usage string for a CLI command',
      group: 'CLI',
    },
    lookup: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get and authenticate the profile and zone file for a Blockstack ID',
      group: 'Querying Blockstack IDs',
    },
    names: {
      type: "array",
      items: [
        {
          name: 'id_address',
          type: "string",
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the list of Blockstack IDs owned by an ID-address.',
      group: 'Querying Blockstack IDs',
    },
    make_keychain: {
      type: "array",
      items: [
        {
          name: 'backup_phrase',
          type: 'string',
          realtype: '12_word',
        },
      ],
      minItems: 0,
      maxItems: 1,
      help: 'Generate the owner and payment private keys, optionally from a given 12-word ' +
      'backup phrase.  If no backup phrase is given, a new one will be generated.',
      group: 'Key Management',
    },
    name_import: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'id_address',
          type: "string",
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
        {
          name: 'gaia_hub',
          type: "string",
          realtype: 'url',
          pattern: '.+',
        },
        {
          name: 'reveal_key',
          type: "string",
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
          pattern: '.+',
        },
        {
          name: 'zonefile_hash',
          type: 'string',
          realtype: 'zonefile_hash',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 4,
      maxItems: 6,
      help: 'Import a name into a namespace you revealed.  The REVEAL_KEY must be the same as ' +
      'the key that revealed the namespace.  You can only import a name into a namespace if ' +
      'the namespace has not yet been launched (i.e. via `namespace_ready`), and if the ' +
      'namespace was revealed less than a year ago.\n' +
      '\n' +
      'The "GAIA_HUB" argument is a URL to a Gaia hub, such as https://gaia.blockstack.org. ' +
      'If you specify an argument for "ZONEFILE," then this argument is ignored in favor of ' +
      'the zone file.  Similarly, if you specify an argument for "ZONEFILE_HASH," then it is ' +
      'used in favor of both "ZONEFILE" and "GAIA_URL."',
      group: 'Namespace Operations',
    },
    namespace_preorder: {
      type: 'array',
      items: [
        {
          name: 'namespace_id',
          type: 'string',
          realtype: 'namespace_id',
          pattern: NAMESPACE_PATTERN,
        },
        {
          name: 'reveal_address',
          type: 'string',
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 3,
      help: 'Preorder a namespace.  This is the first of three steps to creating a namespace.  ' +
      'Once this transaction is confirmed, you will need to use the `namespace_reveal` command ' +
      'to reveal the namespace (within 24 hours, or 144 blocks).',
      group: 'Namespace Operations',
    },
    namespace_reveal: {
      type: 'array',
      items: [
        {
          name: 'namespace_id',
          type: 'string',
          realtype: 'namespace_id',
          pattern: NAMESPACE_PATTERN,
        },
        {
          name: 'reveal_address',
          type: 'string',
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          // version
          name: 'version',
          type: 'string',
          realtype: '2-byte-integer',
          pattern: INT_PATTERN,
        },
        {
          // lifetime
          name: 'lifetime',
          type: 'string',
          realtype: '4-byte-integer',
          pattern: INT_PATTERN,
        },
        {
          // coeff
          name: 'coefficient',
          type: 'string',
          realtype: '1-byte-integer',
          pattern: INT_PATTERN,
        },
        {
          // base
          name: 'base',
          type: 'string',
          realtype: '1-byte-integer',
          pattern: INT_PATTERN,
        },
        {
          // buckets
          name: 'price_buckets',
          type: 'string',
          realtype: 'csv-of-16-nybbles',
          pattern: '^([0-9]{1,2},){15}[0-9]{1,2}$'
        },
        {
          // non-alpha discount
          name: 'nonalpha_discount',
          type: 'string',
          realtype: 'nybble',
          pattern: INT_PATTERN,
        },
        {
          // no-vowel discount
          name: 'no_vowel_discount',
          type: 'string',
          realtype: 'nybble',
          pattern: INT_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 10,
      maxItems: 10,
      help: 'Reveal a preordered namespace, and set the price curve and payment options.  ' +
      'This is the second of three steps required to create a namespace, and must be done ' +
      'shortly after the associated "namespace_preorder" command.',
      group: 'Namespace Operations'
    },
    namespace_ready: {
      type: 'array',
      items: [
        {
          name: 'namespace_id',
          type: 'string',
          realtype: 'namespace_id',
          pattern: NAMESPACE_PATTERN,
        },
        {
          name: 'reveal_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 2,
      maxItems: 2,
      help: 'Launch a revealed namespace.  This is the third and final step of creating a namespace.  ' +
      'Once launched, you will not be able to import names anymore.',
      group: 'Namespace Operations'
    },
    price: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: NAME_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the price of a name',
      group: 'Querying Blockstack IDs',
    },
    price_namespace: {
      type: "array",
      items: [
        {
          name: 'namespace_id',
          type: "string",
          realtype: 'namespace_id',
          pattern: NAMESPACE_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Get the price of a namespace',
      group: 'Namespace Operations',
    },
    profile_sign: {
      type: "array",
      items: [
        {
          name: 'profile',
          type: "string",
          realtype: 'path',
        },
        {
          name: 'owner_key',
          type: "string",
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN
        }
      ],
      minItems: 2,
      maxItems: 2,
      help: 'Sign a profile on disk with a given owner private key.  Print out the signed profile JWT.',
      group: 'Profiles',
    },
    profile_store: {
      type: "array",
      items: [
        {
          name: 'user_id',
          type: "string",
          realtype: 'name-or-id-address',
          pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}|${ID_ADDRESS_PATTERN}`,
        },
        {
          name: 'profile',
          type: "string",
          realtype: 'path',
        },
        {
          name: 'owner_key',
          type: "string",
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN
        },
        {
          name: 'gaia_hub',
          type: "string",
          realtype: 'url',
        }
      ],
      minItems: 3,
      maxItems: 4,
      help: 'Store a profile on disk to a Gaia hub.  USER_ID can be either a Blockstack ID or ' +
      'an ID-address.  If USER_ID is an ID-address, then GAIA_HUB is a required argument.  ' +
      'If USER_ID is a Blockstack ID, then the GAIA_HUB will be looked from using the Blockstack ID\'s ' +
      'zonefile.',
      group: 'Profiles'
    },
    profile_verify: {
      type: "array",
      items: [
        {
          name: 'profile',
          type: "string",
          realtype: 'path',
        },
        {
          name: 'id_address',
          type: 'string',
          realtype: 'id-address',
          pattern: `${ID_ADDRESS_PATTERN}|${PUBLIC_KEY_PATTERN}`,
        }
      ],
      minItems: 2,
      maxItems: 2,
      help: 'Verify a profile on disk using a name or a public key (ID_ADDRESS).',
      group: 'Profiles',
    },
    renew: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'new_id_address',
          type: 'string',
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
        },
        {
          name: 'zonefile_hash',
          type: 'string',
          realtype: 'zonefile_hash',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 6,
      help: 'Renew a name.  Optionally transfer it to a new owner address (NEW_ID_ADDRESS), ' +
      'and optionally load up and give it a new zone file on disk (ZONEFILE).  You will need ' +
      'to later use "zonefile_push" to replicate the zone file to the Blockstack peer network ' +
      'once the transaction confirms.',
      group: 'Blockstack ID Management',
    },
    register: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'gaia_hub',
          type: 'string',
          realtype: 'url',
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
        },
      ],
      minItems: 4,
      maxItems: 5,
      help: 'Register a name the easy way.  This will generate and send two transactions, ' +
      'and generate and replicate a zone file with the given Gaia hub URL (GAIA_HUB).  ' +
      'You can optionally specify a path to a custom zone file on disk (ZONEFILE).',
      group: 'Blockstack ID Management',
    },
    register_subdomain: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'blockstack_id',
          pattern: SUBDOMAIN_PATTERN,
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'gaia_hub',
          type: 'string',
          realtype: 'url',
        },
        {
          name: 'registrar',
          type: 'string',
          realtype: 'url',
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
        },
      ],
      minItems: 4,
      maxItems: 5,
      help: 'Register a subdomain.  This will generate and sign a subdomain zone file record ' +
      'with the given GAIA_HUB URL and send it to the given subdomain registrar (REGISTRAR).',
      group: 'Blockstack ID Management',
    },
    revoke: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 3,
      help: 'Revoke a name.  This renders it unusable until it expires (if ever).',
      group: 'Blockstack ID Management',
    },
    send_btc: {
      type: "array",
      items: [
        {
          name: 'recipient_address',
          type: 'string',
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          name: 'amount',
          type: 'string',
          realtype: 'satoshis',
          pattern: INT_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 3,
      help: 'Send some Bitcoin (in satoshis) from a payment key to an address.',
      group: 'Account Management'
    },
    send_tokens: {
      type: "array",
      items: [
        {
          name: 'address',
          type: 'string',
          realtype: 'address',
          pattern: ADDRESS_PATTERN,
        },
        {
          name: 'type',
          type: 'string',
          realtype: 'token-type',
          pattern: `^${NAMESPACE_PATTERN}$|^STACKS$`
        },
        {
          name: 'amount',
          type: 'string',
          realtype: 'integer',
          pattern: '^[0-9]+$',
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'memo',
          type: 'string',
          realtype: 'string',
          pattern: '^.{0,34}$',
        },
      ],
      minItems: 4,
      maxItems: 5,
      help: 'Send tokens to the given ADDRESS.  The only supported TOKEN-TYPE is "STACKS".  Optionally ' +
      'include a memo string (MEMO) up to 34 characters long.',
      group: 'Account Management',
    },
    transfer: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'new_id_address',
          type: 'string',
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
        {
          name: 'keep_zonefile',
          type: 'string',
          realtype: 'true-or-false',
          pattern: '^true$|^false$',
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 5,
      maxItems: 5,
      help: 'Transfer a Blockstack ID to a new address (NEW_ID_ADDRESS).  Optionally preserve ' +
      'its zone file (KEEP_ZONEFILE).',
      group: 'Blockstack ID Management',
    },
    tx_preorder: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'id_address',
          type: 'string',
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN
        },
      ],
      minItems: 3,
      maxItems: 3,
      help: 'Generate and send NAME_PREORDER transaction, for a Blockstack ID to be owned ' +
      'by a given ID_ADDRESS.',
      group: 'Blockstack ID Management',
    },
    tx_register: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'id_address',
          type: 'string',
          realtype: 'id-address',
          pattern: ID_ADDRESS_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
        },
        {
          name: 'zonefile_hash',
          type: 'string',
          realtype: 'zoenfile_hash',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 5,
      help: 'Generate and send a NAME_REGISTRATION transaction, assigning the given BLOCKSTACK_ID ' +
      'to the given ID_ADDRESS.  Optionally pair the Blockstack ID with a zone file (ZONEFILE) or ' +
      'the hash of the zone file (ZONEFILE_HASH).  You will need to push the zone file to the peer ' +
      'network after the transaction confirms (i.e. with "zonefile_push").',
      group: 'Blockstack ID Management',
    },
    update: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: 'string',
          realtype: 'on-chain-blockstack_id',
          pattern: NAME_PATTERN,
        },
        {
          name: 'zonefile',
          type: 'string',
          realtype: 'path',
        },
        {
          name: 'owner_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'payment_key',
          type: 'string',
          realtype: 'private_key',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          name: 'zonefile_hash',
          type: 'string',
          realtype: 'zonefile_hash',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 4,
      maxItems: 5,
      help: 'Update the zonefile for an on-chain Blockstack ID.  Once the transaction confirms, ' +
      'you will need to push the zone file to the Blockstack peer network with "zonefile_push."',
      group: 'Blockstack ID Management'
    },
    whois: {
      type: "array",
      items: [
        {
          name: 'blockstack_id',
          type: "string",
          realtype: 'blockstack_id',
          pattern: NAME_PATTERN + "|"+ SUBDOMAIN_PATTERN,
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Look up the zone file and owner of a Blockstack ID',
      group: 'Querying Blockstack IDs',
    },
    zonefile_push: {
      type: "array",
      items: [
        {
          name: 'zonefile',
          type: "string",
          realtype: 'path',
        },
      ],
      minItems: 1,
      maxItems: 1,
      help: 'Push a zone file on disk to the Blockstack peer network.',
      group: 'Peer Services',
    },
  },
  additionalProperties: false,
  strict: true
};

// usage string for built-in options
export const USAGE = `Usage: ${process.argv[1]} [options] command [command arguments]
Options can be:
    -c                  Path to a config file (defaults to
                        ${DEFAULT_CONFIG_PATH})

    -e                  Estimate the BTC cost of an transaction (in satoshis).
                        Do not generate or send any transactions.

    -t                  Use the public testnet instead of mainnet.

    -i                  Use integration test framework instead of mainnet.

    -U                  Unsafe mode.  No safety checks will be performed.

    -x                  Do not broadcast a transaction.  Only generate and
                        print them to stdout.

    -B BURN_ADDR        Use the given namespace burn address instead of the one
                        obtained from the Blockstack network (requires -i)

    -D DENOMINATION     Denominate the price to pay in the given units
                        (requires -i and -P)

    -C CONSENSUS_HASH   Use the given consensus hash instead of one obtained
                        from the network (requires -i)

    -F FEE_RATE         Use the given transaction fee rate instead of the one
                        obtained from the Bitcoin network (requires -i)

    -G GRACE_PERIOD     Number of blocks in which a name can be renewed after it
                        expires (requires -i)

    -H URL              Use an alternative Blockstack Core node.

    -N PAY2NS_PERIOD    Number of blocks in which a namespace receives the registration
                        and renewal fees after it is created (requires -i)

    -P PRICE            Use the given price to pay for names or namespaces
                        (requires -i)

    -T URL              Use an alternative Blockstack transaction broadcaster.
`;

/*
 * Format help
 */
function formatHelpString(indent: number, limit: number, helpString: string) : string {
  const lines = helpString.split('\n');
  let buf = "";
  let pad = "";
  for (let i = 0; i < indent; i++) {
    pad += ' ';
  }

  for (let i = 0; i < lines.length; i++) {
    let linebuf = pad.slice();
    const words = lines[i].split(/ /).filter((word) => word.length > 0);

    for (let j = 0; j < words.length; j++) {
      if (words[j].length === 0) {
        // explicit line break 
        linebuf += '\n';
        break;
      }

      if (linebuf.split('\n').slice(-1)[0].length + 1 + words[j].length > limit) {
        linebuf += '\n';
        linebuf += pad;
      }
      linebuf += words[j] + ' ';
    }

    buf += linebuf + '\n';
  }
  return buf;
}

/*
 * Format command usage lines.
 * Generate two strings:
 * raw string: 
 *    COMMAND ARG_NAME ARG_NAME ARG_NAME [OPTINONAL ARG NAME]
 * keyword string:
 *    COMMAND --arg_name TYPE
 *            --arg_name TYPE
 *            [--arg_name TYPE]
 */
function formatCommandHelpLines(commandName: string, commandArgs: Array<Object>) : Object {
  let rawUsage = '';
  let kwUsage = '';
  let kwPad = '';
  const commandInfo = CLI_ARGS.properties[commandName];

  rawUsage = `  ${commandName} `;
  for (let i = 0; i < commandArgs.length; i++) {
    if (!commandArgs[i].name) {
      console.log(commandName);
      console.log(commandArgs[i]);
      throw new Error(`BUG: command info is missing a "name" field`);
    }
    if (i + 1 <= commandInfo.minItems) {
      rawUsage += `${commandArgs[i].name.toUpperCase()} `;
    }
    else {
      rawUsage += `[${commandArgs[i].name.toUpperCase()}] `;
    }
  }

  kwUsage = `  ${commandName} `;
  for (let i = 0; i < commandName.length + 3; i++) {
    kwPad += ' ';
  }
  
  for (let i = 0; i < commandArgs.length; i++) {
    if (!commandArgs[i].realtype) {
      console.log(commandName)
      console.log(commandArgs[i])
      throw new Error(`BUG: command info is missing a "realtype" field`);
    }
    if (i + 1 <= commandInfo.minItems) {
      kwUsage += `--${commandArgs[i].name} ${commandArgs[i].realtype.toUpperCase()}`;
    }
    else {
      kwUsage += `[--${commandArgs[i].name} ${commandArgs[i].realtype.toUpperCase()}]`;
    }
    kwUsage += '\n';
    kwUsage += kwPad;
  }

  return {'raw': rawUsage, 'kw': kwUsage};
}

/*
 * Get the set of commands grouped by command group
 */
function getCommandGroups() : Object {
  let groups = {};
  const commands = Object.keys(CLI_ARGS.properties);
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const group = CLI_ARGS.properties[command].group;
    const help = CLI_ARGS.properties[command].help;
    
    if (!groups.hasOwnProperty(group)) {
      groups[group] = [Object.assign({}, CLI_ARGS.properties[command], {
        'command': command
      })];
    }
    else {
      groups[group].push(Object.assign({}, CLI_ARGS.properties[command], {
        'command': command
      }));
    }
  }
  return groups;
}

/*
 * Make all commands list
 */
export function makeAllCommandsList() : string {
  const groups = getCommandGroups();
  const groupNames = Object.keys(groups).sort();

  let res = `All commands (run '${process.argv[1]} help COMMAND' for details):\n`;
  for (let i = 0; i < groupNames.length; i++) {
    res += `  ${groupNames[i]}: `;
    let cmds = [];
    for (let j = 0; j < groups[groupNames[i]].length; j++) {
      cmds.push(groups[groupNames[i]][j].command);
    }

    // wrap at 80 characters
    const helpLineSpaces = formatHelpString(4, 70, cmds.join(' '));
    const helpLineCSV = '    ' + helpLineSpaces.split('\n    ')
      .map((line) => line.trim().replace(/ /g, ', ')).join('\n    ') + '\n';

    res += '\n' + helpLineCSV;
    res += '\n';
  }
  return res.trim();
}

/*
 * Make a usage string for a single command
 */
export function makeCommandUsageString(command: string) : string {
  let res = "";
  const commandInfo = CLI_ARGS.properties[command];
  if (!commandInfo || command === 'help') {
    return makeAllCommandsList();
  }

  const groups = getCommandGroups();
  const groupNames = Object.keys(groups).sort();
  const help = commandInfo.help;
  
  const cmdFormat = formatCommandHelpLines(command, commandInfo.items);
  const formattedHelp = formatHelpString(2, 78, help);

  // make help string for one command 
  res += `Command: ${command}\n`;
  res += `Usage:\n`;
  res += `${cmdFormat.raw}\n`;
  res += `${cmdFormat.kw}\n`;
  res += formattedHelp;
  return res;
}

/*
 * Make the usage documentation
 */
export function makeUsageString(usageString: string) : string {
  let res = `${USAGE}\n\nCommand reference\n`;
  const groups = getCommandGroups();
  const groupNames = Object.keys(groups).sort();

  for (let i = 0; i < groupNames.length; i++) {
    const groupName = groupNames[i];
    const groupCommands = groups[groupName];

    res += `Command group: ${groupName}\n\n`;
    for (let j = 0; j < groupCommands.length; j++) {
      const command = groupCommands[j].command;
      const help = groupCommands[j].help;

      const commandInfo = CLI_ARGS.properties[command];

      const cmdFormat = formatCommandHelpLines(command, commandInfo.items);
      const formattedHelp = formatHelpString(4, 76, help);

      res += cmdFormat.raw;
      res += '\n';
      res += cmdFormat.kw;
      res += '\n';
      res += formattedHelp;
      res += '\n';
    }
    res += '\n';
  }    
  
  return res;
}

/*
 * Print usage
 */
export function printUsage() {
  console.error(makeUsageString(USAGE));
}

/*
 * Implement just enough getopt(3) to be useful.
 * Only handles short options.
 * Returns an object whose keys are option flags that map to true/false,
 * or to a value.
 * The key _ is mapped to the non-opts list.
 */
export function getCLIOpts(argv: Array<string>, 
                           opts: string = 'eitUxC:F:B:P:D:G:N:H:T:') : Object {
  let optsTable = {};
  let remainingArgv = [];
  let argvBuff = argv.slice(0);

  for (let i = 0; i < opts.length; i++) {
    if (opts[i] == ':') {
      continue;
    }
    if (i+1 < opts.length && opts[i+1] == ':') {
      optsTable[opts[i]] = null;
    }
    else {
      optsTable[opts[i]] = false;
    }
  }

  for (let opt of Object.keys(optsTable)) {
    for (let i = 0; i < argvBuff.length; i++) {
      if (argvBuff[i] === null) {
        break;
      }
      if (argvBuff[i] === '--') {
        break;
      }

      const argvOpt = `-${opt}`;
      if (argvOpt === argvBuff[i]) {
        if (optsTable[opt] === false) {
          // boolean switch
          optsTable[opt] = true;
          argvBuff[i] = '';
        }
        else {
          // argument
          optsTable[opt] = argvBuff[i+1];
          argvBuff[i] = '';
          argvBuff[i+1] = '';
        }
      }
    }
  }

  for (let i = 0; i < argvBuff.length; i++) {
    if (argvBuff[i].length > 0) {
      if (argvBuff[i] === '--') {
        continue;
      }
      remainingArgv.push(argvBuff[i])
    }
  }

  optsTable['_'] = remainingArgv;
  return optsTable;
}


/*
 * Use the CLI schema to get all positional and keyword args
 * for a given command.
 */
export function getCommandArgs(command: string, argsList: Array<string>) {
  let commandProps = CLI_ARGS.properties[command].items;
  if (!Array.isArray(commandProps)) {
    commandProps = [commandProps];
  }

  let orderedArgs = [];
  let foundArgs = {};

  // scan for keywords 
  for (let i = 0; i < argsList.length; i++) {
    if (argsList[i].startsWith('--')) {
      // positional argument 
      const argName = argsList[i].slice(2);
      let argValue = null;

      // dup?
      if (foundArgs.hasOwnProperty(argName)) {
        return {
          'status': false,
          'error': `duplicate argument ${argsList[i]}`,
        };
      }

      for (let j = 0; j < commandProps.length; j++) {
        if (!commandProps[j].hasOwnProperty('name')) {
          continue;
        }
        if (commandProps[j].name === argName) {
          // found!
          // end of args?
          if (i + 1 >= argsList.length) {
            return {
              'status': false,
              'error': `no value for argument ${argsList[i]}`
            };
          }

          argValue = argsList[i+1];
        }
      }

      if (argValue) {
        // found something!
        i += 1;
        foundArgs[argName] = argValue;
      }
      else {
        return {
          'status': false,
          'error': `no such argument ${argsList[i]}`,
        };
      }
    }
    else {
      // positional argument
      orderedArgs.push(argsList[i]);
    }
  }

  // merge foundArgs and orderedArgs back into an ordered argument list
  // that is conformant to the CLI specification.
  let mergedArgs = [];
  let orderedArgIndex = 0;

  for (let i = 0; i < commandProps.length; i++) {
    if (!commandProps[i].hasOwnProperty('name')) {
      // positional argument
      if (orderedArgIndex >= orderedArgs.length) {
        break;
      }
      mergedArgs.push(orderedArgs[orderedArgIndex]);
      orderedArgIndex += 1;
    }
    else if (!foundArgs.hasOwnProperty(commandProps[i].name)) {
      // positional argument 
      if (orderedArgIndex >= orderedArgs.length) {
        break;
      }
      mergedArgs.push(orderedArgs[orderedArgIndex]);
      orderedArgIndex += 1;
    }
    else {
      // keyword argument 
      mergedArgs.push(foundArgs[commandProps[i].name]);
    }
  }

  return {
    'status': true,
    'arguments': mergedArgs
  };
}

/*
 * Check command args
 */
type checkArgsSuccessType = {
  'success': true,
  'command': string,
  'args': Array<string>
};

type checkArgsFailType = {
  'success': false,
  'error': string,
  'command': string,
  'usage': boolean
};

export function checkArgs(argList: Array<string>) 
  : checkArgsSuccessType | checkArgsFailType {
  if (argList.length <= 2) {
     return {
       'success': false,
       'error': 'No command given',
       'usage': true,
       'command': '',
     }
  }

  const commandName = argList[2];
  const allCommandArgs = argList.slice(3);

  if (!CLI_ARGS.properties.hasOwnProperty(commandName)) {
     return {
       'success': false,
       'error': `Unrecognized command '${commandName}'`,
       'usage': true,
       'command': commandName,
     };
  }

  const parsedCommandArgs = getCommandArgs(commandName, allCommandArgs);
  if (!parsedCommandArgs.status) {
    return {
      'success': false,
      'error': parsedCommandArgs.error,
      'usage': true,
      'command': commandName,
    };
  }

  const commandArgs = parsedCommandArgs.arguments;

  const commands = new Object();
  commands[commandName] = commandArgs;

  const ajv = Ajv();
  const valid = ajv.validate(CLI_ARGS, commands);
  if (!valid) {
     // console.error(ajv.errors);
     return {
       'success': false,
       'error': 'Invalid command arguments',
       'usage': true,
       'command': commandName,
     };
  }

  return {
    'success': true, 
    'command': commandName, 
    'args': commandArgs
  };
}

/**
 * Load the config file and return a config dict.
 * If no config file exists, then return the default config.
 *
 * @configPath (string) the path to the config file.
 * @networkType (sring) 'mainnet', 'regtest', or 'testnet'
 */
export function loadConfig(configFile: string, networkType: string) : Object {
  if (networkType !== 'mainnet' && networkType !== 'testnet' && networkType != 'regtest') {
    throw new Error("Unregognized network")
  }

  let configData = null;
  let configRet = null;

  if (networkType === 'mainnet') {
    configRet = Object.assign({}, CONFIG_DEFAULTS);
  } else if (networkType === 'regtest') {
    configRet = Object.assign({}, CONFIG_REGTEST_DEFAULTS);
  } else {
    configRet = Object.assign({}, CONFIG_TESTNET_DEFAULTS);
  }

  try {
    configData = JSON.parse(fs.readFileSync(configFile).toString());
    Object.assign(configRet, configData);
  }
  catch (e) {
    ;
  }

  return configRet;
}

