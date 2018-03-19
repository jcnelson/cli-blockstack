/* @flow */

const Ajv = require('ajv');
const parseArgs = require('minimist');
const blockstack = require('blockstack');
const process = require('process');

// CLI usage
const CLI_ARGS = {
  lookup: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: 1,
    },
  },
  names: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: 1,
      pattern: '^([123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{1,35})$',
    },
  },
  price: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: 1,
    },
  },
  whois: {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      maxLength: 1,
    },
  },
};

// usage string
const USAGE = `Usage: ${process.argv[0]} [options] command [command arguments]
Options can be:
    -t                  Use integration test framework
   
Command can be:
    lookup NAME         Look up a name's profile
    names ADDR          List all names owned by an address
    price NAME          Find out how much a name costs
    whois NAME          Get basic name information for a Blockstack ID
`;

/*
 * Parse CLI arguments (given as a list of strings).
 * Returns an object with all values set.
 */
function getCLIOpts(argv: Array<string>) {
  return parseArgs(argv);
}

/*
 * Check command args
 */
type checkArgsSuccessType = {'success': true, 'command': string, 'args': Array<string>};
type checkArgsFailType = {'success': false, 'error': string, 'usage': boolean};

function checkArgs(argList: Array<string>) : checkArgsSuccessType | checkArgsFailType {
  if (argList.length <= 2) {
     return {'success': false, 'error': 'No command given', 'usage': true}
  }

  const commandName = argList[2];
  const commandArgs = argList.slice(3);

  if (!CLI_ARGS.hasOwnProperty(commandName)) {
     return {'success': false, 'error': `Unrecognized command '${commandName}'`, 'usage': true}
  }

  const commands = {commandName: commandArgs};
  const ajv = Ajv();
  const valid = ajv.validate(CLI_ARGS, commands);
  if (!valid) {
     return {'success': false, 'error': 'Invalid command arguments', 'usage': true}
  }

  return {'success': true, 'command': commandName, 'args': commandArgs};
}

/*
 * Get a name's record information
 */
function whois(network: Object, args: Array<string>) {
  const name = args[0];
  return network.getNameInfo(name);
}

/*
 * Get a name's price information
 */
function price(network: Object, args: Array<string>) {
  const name = args[0];
  return network.getNamePrice(name);
}

/*
 * Get names owned by an address
 */
function names(network: Object, args: Array<string>) {
  const address = args[0];
  return network.getNamesOwned(address);
}

/*
 * Look up a name's profile
 */
function lookup(network: Object, args: Array<string>) {
  const name = args[0];
  const zonefileLookupUrl = network.blockstackAPIUrl + '/v1/names';
  return blockstack.lookupProfile(name, zonefileLookupUrl);
}

/*
 * Global set of commands
 */
const COMMANDS = {
  'lookup': lookup,
  'names': names,
  'price': price,
  'whois': whois
};

/*
 * CLI main entry point
 */
export function CLIMain() {
  const argv = process.argv;
  const opts = getCLIOpts(argv);
  const blockstackNetwork = blockstack.network.defaults.MAINNET_DEFAULT;

  const cmdArgs = checkArgs(opts._);
  if (!cmdArgs.success) {
    console.error(cmdArgs.error);
    if (cmdArgs.usage) {
      console.error(USAGE);
    }
    process.exit(1);
  }
  else {
    const method = COMMANDS[cmdArgs.command];
    method(blockstackNetwork, cmdArgs.args)
    .then((result) => console.log(result))
    .then(() => process.exit(0));
  }
}


