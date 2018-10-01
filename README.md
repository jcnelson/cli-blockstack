# cli-blockstack
Node.js CLI for Blockstack, built on blockstack.js.

**WARNING**:  This tool is not production-ready, and is meant for developers and
power users who don't mind helping us debug it.  Please open issues if you find
any!

## How to Install

You need to install the `feature/stacks-transactions` branch of 
[blockstack.js](https://github.com/blockstack/blockstack.js).  For some
Gaia methods, you will need `feature/stacks-transactions-authResponse-1.3`.

```
$ git clone https://github.com/blockstack/blockstack.js
$ cd blockstack.js
$ git checkout feature/stacks-transactions # or feature/stacks-transactions-authResponse-1.3
$ npm install
$ sudo npm link
```

Once this branch of blockstack.js is globally linked, you can install this CLI
tool.

```
$ git clone https://github.com/jcnelson/cli-blockstack
$ cd cli-blockstack
$ npm install
$ npm link blockstack
$ npm run build
$ sudo npm install -g
```

## How to Use

The CLI has a built-in help system.  Just run `blockstack-cli` to access it.
