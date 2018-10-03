# cli-blockstack
Node.js CLI for Blockstack, built on blockstack.js.

**WARNING**:  This tool is not production-ready, and is meant for developers and
power users who don't mind helping us debug it.  Please open issues if you find
any!

## How to Install

You can install the CLI by cloning the repo and running `npm run build`, as
follows:

```
$ git clone https://github.com/jcnelson/cli-blockstack
$ cd cli-blockstack
$ npm install
$ npm run build
$ sudo npm link
```

This should install `blockstack-cli` to your `$PATH`.

## How to Install with Support for the Stacks token

If you want to use the CLI tool with the Blockstack testnet (which supports the
Stacks token), you'll need to link against the `feature/stacks-transactions`
branch of [blockstack.js](https://github.com/blockstack.js).  This is a tedious
and error-prone process that only seasoned developers should attempt.

First, go and install the right branch of blockstack.js:

```
$ git clone https://github.com/blockstack/blockstack.js
$ cd blockstack.js
$ git checkout feature/stacks-transactions # or feature/stacks-transactions-authResponse-1.3
$ npm install
$ sudo npm link
```

Once this branch of blockstack.js is globally installed (or globally linked),
you can install this CLI tool.

```
$ git clone https://github.com/jcnelson/cli-blockstack
$ cd cli-blockstack
$ npm install
$ npm link blockstack
$ npm run build
$ sudo npm install -g
```

If you can't get it to install cleanly, I recommend installing the
`feature/stacks-transactions` branch globally instead of linking it.  You could
do this in a Docker container if you don't want to mess with your global
`node_modules` directory, for example.

## How to Use

The CLI has a built-in help system.  Just run `blockstack-cli` to access it.
You can list all command documentation with `blockstack-cli help all`.
