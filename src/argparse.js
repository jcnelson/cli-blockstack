/* @flow */

const Ajv = require('ajv');
const process = require('process');

import os from 'os'
import fs from 'fs'

const NAME_PATTERN = 
  '^([0-9a-z_.+-]{3,37})$'

const NAMESPACE_PATTERN = 
  '^([0-9a-z_-]{1,19})$'

const ADDRESS_PATTERN = 
  '^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,35})$';

const PRIVATE_KEY_PATTERN = 
  '^([0-9a-f]{64,66})$'

const INT_PATTERN = '^[0-9]+$'

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
    lookup: {
      type: "array",
      items: {
        type: "string",
        pattern: NAME_PATTERN
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
    preorder: {
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
    price: {
      type: "array",
      items: {
        type: "string",
        pattern: NAME_PATTERN,
      },
      minItems: 3,
      maxItems: 3,
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
      ],
      minItems: 3,
      maxItems: 5,
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
    update: {
      type: "array",
      items: [
        {
          type: 'string',
          pattern: NAME_PATTERN,
        },
        {
          type: 'string',
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
      minItems: 4,
      maxItems: 4,
    },
    whois: {
      type: "array",
      items: {
        type: "string",
        pattern: NAME_PATTERN
      },
      minItems: 4,
      maxItems: 4
    },
  },
  additionalProperties: false,
  strict: true
};

// usage string
const USAGE = `Usage: ${process.argv[0]} [options] command [command arguments]
Options can be:
    -c                  Path to a config file (defaults to ${DEFAULT_CONFIG_PATH})
    -e                  Estimate the BTC cost of an operation (in satoshis).
                        Do not generate or send any transactions.
    -t                  Use integration test framework
    -U                  Unsafe mode.  No safety checks will be performed.
    -x                  Do not broadcast a transaction.  Only generate and
                        print them.
    -C CONSENSUS_HASH   Use the given consensus hash instead of one obtained
                        over the network (requires -t)
    -F FEE_RATE         Use the given transaction fee rate instead of the one
                        obtained from the Bitcoin network (requires -t)
    -B BURN_ADDR        Use the given namespace burn address instead of the one
                        obtained from the Bitcoin network (requires -t)
Command can be:
    lookup NAME         Look up a name's profile
    names ADDR          List all names owned by an address
    namespace_preorder NAMESPACE REVEAL_ADDR PAYMENT_KEY
                        Preorder a namespace.  EXPENSIVE!
    namespace_reveal NAMESPACE REVEAL_ADDR VERSION LIFETIME COEFF BASE
      BUCKET_CSV NONALPHA_DISCOUNT NOVOWEL_DISCOUNT PAYMENT_KEY
                        Reveal a namespace with the given parameters
    namespace_ready NAMESPACE REVEAL_KEY
                        Launch a revealed namespace
    preorder NAME ADDR PAYMENT_KEY
                        Preorder a name to a given address
    price NAME          Find out how much a name costs
    register NAME ADDR NEW_ZONEFILE PAYMENT_KEY
                        Register a name to a given address, and
                        give it its first zone file
    revoke NAME OWNER_KEY PAYMENT_KEY
                        Revoke a name
    renew NAME OWNER_KEY PAYMENT_KEY [NEW_ADDR [NEW_ZONEFILE]]
                        Renew a name, optionally sending it to a new
                        address and giving it a new zone file
    transfer NAME NEW_ADDR KEEP_ZONEFILE OWNER_KEY PAYMENT_KEY
                        Transfer a name to a new address
    update NAME ZONEFILE OWNER_KEY PAYMENT_KEY
                        Update a name's zone file
    whois NAME          Get basic name information for a Blockstack ID
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
                           opts: string = 'etUxC:F:B:') : Object {
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

