sfdx-prebuilt
==================

An NPM installer for [SFDX](https://developer.salesforce.com/tools/sfdxcli), API interface for Force.com and all Salesforce DX features.

[![Build Status](https://travis-ci.org/coveo/sfdx-prebuilt.svg?branch=master)](https://travis-ci.org/coveo/sfdx-prebuilt)

Building and Installing
-----------------------

```shell
npm install sfdx-prebuilt
```

Or grab the source and

```shell
node ./install.js
```

What this installer is really doing is just grabbing a particular "blessed" (by
this module) version of SFDX. As new versions of SFDX are released
and vetted, this module will be updated accordingly.

Running via node
----------------

The package exports a `path` string that contains the path to the
SFDX binary/executable.

Below is an example of using this package via node.

```javascript
var path = require('path')
var childProcess = require('child_process')
var sfdx = require('sfdx-prebuilt')
var binPath = sfdx.path

var childArgs = [
  'force',
  '--help' 
]

childProcess.execFile(binPath, childArgs, function(err, stdout, stderr) {
  // handle results
})

```

Or `exec()` method is also provided for convenience:

```javascript
var sfdx = require('sfdx-prebuilt')
var program = sfdx.exec('force', '--help')
program.stdout.pipe(process.stdout)
program.stderr.pipe(process.stderr)
program.on('exit', function(code) {
  // do something on end
})
```

Note: [childProcess.spawn()](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options) is called inside `exec()`.

Versioning
----------

The major and minor number tracks the version of SFDX that will be
installed. The patch number is incremented when there is either an installer
update or a patch build of the sfdx binary.