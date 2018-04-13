/* @flow */

const Ajv = require('ajv');
const process = require('process');

import os from 'os'
import fs from 'fs'

export const NAME_PATTERN = 
  '^([0-9a-z_.+-]{3,37})$'

export const NAMESPACE_PATTERN = 
  '^([0-9a-z_-]{1,19})$'

export const ADDRESS_PATTERN = 
  '^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,35})$';

export const PRIVATE_KEY_PATTERN = 
  '^([0-9a-f]{64,66})$'

export const PUBLIC_KEY_PATTERN = 
  '^([0-9a-f]{66,130})$'

export const INT_PATTERN = '^[0-9]+$'

export const ZONEFILE_HASH_PATTERN = '^([0-9a-f]{40})$'

export const URL_PATTERN = "^http[s]?://.+$"

export const SUBDOMAIN_PATTERN =
  '^([0-9a-z_+-]{1,37})\.([0-9a-z_.+-]{3,37})$'

const CONFIG_DEFAULTS = {
  blockstackAPIUrl: 'https://core.blockstack.org',
  broadcastServiceUrl: 'https://broadcast.blockstack.org',
  utxoServiceUrl: 'https://utxo.technofractal.com',
};

const CONFIG_REGTEST_DEFAULTS = {
  blockstackAPIUrl: 'http://localhost:16268',
  broadcastServiceUrl: 'http://localhost:16269',
  utxoServiceUrl: 'http://localhost:18332'
};

export const DEFAULT_CONFIG_PATH = '~/.blockstack-cli.conf'
export const DEFAULT_CONFIG_REGTEST_PATH = '~/.blockstack-cli-regtest.conf'

// CLI usage
const CLI_ARGS = {
  type: 'object',
  properties: {
    announce: {
      type: "array",
      items: [
        {
          type: "string",
          pattern: ZONEFILE_HASH_PATTERN,
        },
        {
          type: "string",
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 2,
      maxItems: 2,
    },
    balance: {
      type: "array",
      items: {
        type: "string",
        pattern: ADDRESS_PATTERN,
      },
      minItems: 1,
      maxItems: 1,
    },
    get_account_history: {
      type: "array",
      items: [
        {
          type: "string",
          pattern: ADDRESS_PATTERN,
        },
        {
          type: "string",
          pattern: "^[0-9]+$",
        },
        {
          type: "string",
          pattern: "^[0-9]+$",
        },
        {
          type: "string",
          pattern: "^[0-9]+$",
        },
      ],
      minItems: 4,
      maxItems: 4,
    },
    get_account_at: {
      type: "array",
      items: [
        {
          type: "string",
          pattern: ADDRESS_PATTERN,
        },
        {
          type: "string",
          pattern: "^[0-9]+$",
        },
      ],
      minItems: 2,
      maxItems: 2,
    },
    get_blockchain_record: {
      type: "array",
      items: {
        type: "string",
        pattern: `^${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
      },
      minItems: 1,
      maxItems: 1,
    },
    get_blockchain_history: {
      type: "array",
      items: {
        type: "string",
        pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
      },
      minItems: 1,
      maxItems: 3,
    },
    get_namespace_blockchain_record: {
      type: "array",
      items: {
        type: "string",
        pattern: NAMESPACE_PATTERN,
      },
      minItems: 1,
      maxItems: 1,
    },
    get_owner_keys: {
      type: "array",
      items: [
        {
          type: "string",
        },
        {
          type: "string",
          pattern: "^[0-9]+$",
        }
      ],
      minItems: 1,
      maxItems: 2
    },
    get_payment_key: {
      type: "array",
      items: [
        {
          type: "string",
        },
      ],
      minItems: 1,
      maxItems: 1
    },
    get_zonefile: {
      type: "array",
      items: {
        type: "string",
        pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
      },
      minItems: 1,
      maxItems: 1,
    },
    lookup: {
      type: "array",
      items: {
        type: "string",
        pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}$`,
      },
      minItems: 1,
      maxItems: 1,
    },
    names: {
      type: "array",
      items: {
        type: "string",
        pattern: ADDRESS_PATTERN,
      },
      minItems: 1,
      maxItems: 1,
    },
    name_import: {
      type: "array",
      items: [
        {
          type: "string",
          pattern: NAME_PATTERN,
        },
        {
          type: "string",
          pattern: ADDRESS_PATTERN,
        },
        {
          type: "string",
          pattern: ZONEFILE_HASH_PATTERN,
        },
        {
          type: "string",
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 4,
      maxItems: 4
    },
    namespace_preorder: {
      type: 'array',
      items: [
        {
          type: 'string',
          pattern: NAMESPACE_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 3,
    },
    namespace_reveal: {
      type: 'array',
      items: [
        {
          type: 'string',
          pattern: NAMESPACE_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          // version
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          // lifetime
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          // coeff
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          // base
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          // buckets
          type: 'string',
          pattern: '^([0-9]{1,2},){15}[0-9]{1,2}$'
        },
        {
          // non-alpha discount
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          // no-vowel discount
          type: 'string',
          pattern: INT_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 10,
      maxItems: 10,
    },
    namespace_ready: {
      type: 'array',
      items: [
        {
          type: 'string',
          pattern: NAMESPACE_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 2,
      maxItems: 2,
    },
    price: {
      type: "array",
      items: {
        type: "string",
        pattern: NAME_PATTERN,
      },
      minItems: 1,
      maxItems: 1,
    },
    price_namespace: {
      type: "array",
      items: {
        type: "string",
        pattern: NAMESPACE_PATTERN,
      },
      minItems: 1,
      maxItems: 1,
    },
    profile_sign: {
      type: "array",
      items: [
        {
          type: "string",
        },
        {
          type: "string",
          pattern: PRIVATE_KEY_PATTERN
        }
      ],
      minItems: 2,
      maxItems: 2,
    },
    profile_store: {
      type: "array",
      items: [
        {
          type: "string",
          pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}`,
        },
        {
          type: "string",
        },
        {
          type: "string",
          pattern: PRIVATE_KEY_PATTERN
        },
      ],
    },
    profile_verify: {
      type: "array",
      items: [
        {
          type: "string",
        },
        {
          type: "string",
          pattern: `${ADDRESS_PATTERN}|${PUBLIC_KEY_PATTERN}`
        }
      ]
    },
    renew: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
        },
        {
          type: 'string',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 6,
    },
    register: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 4,
      maxItems: 4,
    },
    revoke: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 3,
    },
    send_tokens: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
          pattern: `${NAMESPACE_PATTERN}|^STACKS$`,
        },
        {
          type: 'string',
          pattern: '^[0-9]+$',
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: '^.{0,34}$',
        },
      ],
      minItems: 4,
      maxItems: 5,
    },
    transfer: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
          pattern: '^true$|^false$',
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
      ],
      minItems: 5,
      maxItems: 5,
    },
    tx_preorder: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN
        },
      ],
      minItems: 3,
      maxItems: 3,
    },
    tx_register: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
          pattern: ADDRESS_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
        },
        {
          type: 'string',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 3,
      maxItems: 5,
    },
    update: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string'
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: PRIVATE_KEY_PATTERN,
        },
        {
          type: 'string',
          pattern: ZONEFILE_HASH_PATTERN,
        },
      ],
      minItems: 4,
      maxItems: 5,
    },
    whois: {
      type: "array",
      items: {
        type: "string",
        pattern: `${NAME_PATTERN}|${SUBDOMAIN_PATTERN}`,
      },
      minItems: 1,
      maxItems: 1
    },
    zonefile_push: {
      type: "array",
      items: {
        type: "string"
      },
      minItems: 1,
      maxItems: 1
    },
  },
  additionalProperties: false,
  strict: true
};

// usage string
const USAGE = `Usage: ${process.argv[1]} [options] command [command arguments]
Options can be:
    -c                  Path to a config file (defaults to
                        ${DEFAULT_CONFIG_PATH})

    -e                  Estimate the BTC cost of an transaction (in satoshis).
                        Do not generate or send any transactions.

    -t                  Use integration test framework instead of mainnet.

    -U                  Unsafe mode.  No safety checks will be performed.

    -x                  Do not broadcast a transaction.  Only generate and
                        print them to stdout.

    -C CONSENSUS_HASH   Use the given consensus hash instead of one obtained
                        from the network (requires -t)

    -F FEE_RATE         Use the given transaction fee rate instead of the one
                        obtained from the Bitcoin network (requires -t)

    -B BURN_ADDR        Use the given namespace burn address instead of the one
                        obtained from the Blockstack network (requires -t)

    -P PRICE            Use the given price to pay for names or namespaces
                        (requires -t)

    -D DENOMINATION     Denominate the price to pay in the given units
                        (requires -t and -P)

Command reference
  Querying Blockstack IDs
    get_blockchain_record BLOCKSTACK_ID
                        Get the full on-chain record for a Blockstack ID

    get_blockchain_history BLOCKSTACK_ID [START_BLOCK [END_BLOCK]]
                        Get the history of operations for a Blockstack ID

    lookup BLOCKSTACK_ID
                        Look up a Blockstack ID's profile and zonefile

    price BLOCKSTACK_ID
                        Find out how much a Blockstack ID costs, and in
                        what currency units.

    whois BLOCKSTACK_ID 
                        Get basic name and zonefile information for a
                        Blockstack ID

  Querying the Blockchain
    names ADDR          List all Blockstack IDs owned by an account address


  Namespace Operations
    namespace_preorder NAMESPACE REVEAL_ADDR PAYMENT_KEY
                        Preorder a namespace.  EXPENSIVE!

    namespace_reveal NAMESPACE REVEAL_ADDR VERSION LIFETIME COEFF BASE
      BUCKET_CSV NONALPHA_DISCOUNT NOVOWEL_DISCOUNT PAYMENT_KEY
                        Reveal a namespace with the given parameters

    namespace_ready NAMESPACE REVEAL_KEY
                        Launch a revealed namespace

    name_import NAME RECIPIENT_ADDR ZONEFILE_HASH IMPORT_KEY
                        Import a name into a namespace

    price_namespace NAMESPACE_ID
                        Find out how much a Blockstack namespace costs, and in
                        what currency units.

  Peer Services
    announce MESSAGE_HASH PRIVATE_KEY
                        Broadcast a message on the blockchain for subscribers to read

    get_zonefile NAME
                        Get a Blockstack ID's raw zonefile

    zonefile_push ZONEFILE_DATA_OR_PATH
                        Push an already-announced zone file to the Atlas network


  Blockstack ID Management
    register BLOCKSTACK_ID ADDR ZONEFILE PAYMENT_KEY
                        Register a Blockstack ID to a given address.  This
                        will automatically generate and propagate the two
                        blockchain transactions required to do this, and
                        will automatically propagate the given zone file
                        to the Blockstack peer network once the transactions
                        confirm.

    revoke BLOCKSTACK_ID OWNER_KEY PAYMENT_KEY
                        Revoke a Blockstack ID

    renew BLOCKSTACK_ID OWNER_KEY PAYMENT_KEY [ADDR [ZONEFILE [ZONEFILE_HASH]]]
                        Renew a name, optionally sending it to a new
                        address and giving it a new zone file.  If ZONEFILE_HASH
                        is given, then ZONEFILE will be ignored.

    transfer BLOCKSTACK_ID NEW_ADDR KEEP_ZONEFILE OWNER_KEY PAYMENT_KEY
                        Transfer a name to a new address.  If KEEP_ZONEFILE
                        is True, then the Blockstack ID's zone file will
                        be preserved.

    update BLOCKSTACK_ID ZONEFILE OWNER_KEY PAYMENT_KEY [ZONEFILE_HASH]
                        Update a Blockstack ID's zone file.  If ZONEFILE_HASH
                        is given, ZONEFILE will be ignored.

  Advanced Blockstack ID Management
    tx_preorder BLOCKSTACK_ID ADDR PAYMENT_KEY
                        (ADVANCED) Generate and send a NAME_PREORDER transaction
                        that will preorder a Blockstack ID to a given address.
                        Consider using the 'register' command instead.

    tx_register BLOCKSTACK_ID ADDR PAYMENT_KEY [ZONEFILE [ZONEFILE_HASH]]
                        (ADVANCED) Generate and send a NAME_REGISTRATION
                        transaction that will register a preordered Blockstack
                        ID to a given address and optionally give it its first
                        zone file.  If ZONEFILE_HASH is given, then ZONEFILE
                        will be ignored.  The zone file will not be propagated
                        to the Blockstack peer network--you will have to do that
                        yourself with the 'zonefile_push' command.  Consider
                        using the 'register' command instead.

  Profile Management
    profile_sign PATH PRIVATE_KEY
                        Sign profile JSON with a given key.

    profile_store NAME PATH PRIVATE_KEY
                        Store a signed profile to a name's Gaia hub

    profile_verify PATH PUBLIC_KEY_OR_ADDRESS
                        Verify a signed profile with a public key or address. 

  Key Management
    get_owner_keys 12_WORD_PHRASE [MAX_INDEX]
                        Get the owner private key(s) and ID-addresses from a
                        12-word backup phrase.  If MAX_INDEX is given, then 
                        then generate the owner keys and ID-addresses from 
                        index 0 to MAX_INDEX.  Otherwise, only generate the
                        key and ID-address at index 0.

    get_payment_key 12_WORD_PHRASE
                        Get the payment private key of a 12-word backup phrase.

  Account Management
    balance ADDRESS
                        Get the balances of all of an address's tokens

    get_account_at ADDRESS BLOCK_HEIGHT
                        Get the state(s) of an account at a particular block height

    get_account_history ADDRESS PAGE
                        Get a page of an account's history

    send_tokens ADDRESS TOKEN_TYPE AMOUNT PRIVKEY [MEMO]
                        Send tokens to an account address using the private key of
                        an existing account.  TOKEN_TYPE is the name of the namespace
                        that defines the token, or "STACKS".  Optionally include
                        a memo in the transaction of up to 34 bytes.
`;

/*
 * Print usage
 */
export function printUsage() {
  console.error(USAGE);
}

/*
 * Implement just enough getopt(3) to be useful.
 * Only handles short options.
 * Returns an object whose keys are option flags that map to true/false,
 * or to a value.
 * The key _ is mapped to the non-opts list.
 */
export function getCLIOpts(argv: Array<string>, 
                           opts: string = 'etUxC:F:B:P:D:') : Object {
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
  'usage': boolean
};

export function checkArgs(argList: Array<string>) 
  : checkArgsSuccessType | checkArgsFailType {
  if (argList.length <= 2) {
     return {
       'success': false,
       'error': 'No command given',
       'usage': true
     }
  }

  const commandName = argList[2];
  const commandArgs = argList.slice(3);

  if (!CLI_ARGS.properties.hasOwnProperty(commandName)) {
     return {
       'success': false,
       'error': `Unrecognized command '${commandName}'`,
       'usage': true
     };
  }

  const commands = new Object();
  commands[commandName] = commandArgs;

  const ajv = Ajv();
  const valid = ajv.validate(CLI_ARGS, commands);
  if (!valid) {
     console.error(ajv.errors);
     return {
       'success': false,
       'error': 'Invalid command arguments',
       'usage': true
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
 * @regtest (boolean) are we in regtest mode?
 */
export function loadConfig(configFile: string, regtest: boolean) : Object {
  let configData = null;
  let configRet = Object.assign({}, 
    regtest ? CONFIG_REGTEST_DEFAULTS : CONFIG_DEFAULTS);

  try {
    configData = JSON.parse(fs.readFileSync(configFile).toString());
    Object.assign(configRet, configData);
  }
  catch (e) {
    console.debug(`Failed to load ${configFile}, using defaults`);
  }

  return configRet;
}

