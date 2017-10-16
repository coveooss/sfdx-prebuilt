/**
 * Nodeunit functional tests.  Requires internet connection to validate sfdx
 * functions correctly.
 */

var childProcess = require('child_process')
var fs = require('fs')
var path = require('path')
var sfdx = require('../lib/sfdxprebuilt')
var util = require('../lib/util')

exports.testDownload = function (test) {
  test.expect(1)
  test.ok(fs.existsSync(sfdx.path), 'Binary file should have been downloaded')
  test.done()
}


exports.testSFDXExecutesTestScript = function (test) {
  test.expect(1)

  var childArgs = [
    'help'
  ]

  childProcess.execFile(sfdx.path, childArgs, function (err, stdout) {
    var value = (stdout.indexOf('sfdx plugins') !== -1)
    test.ok(value, 'Test script should have executed help')
    test.done()
  })
}

exports.testBinFile = function (test) {
  test.expect(1) 

  childProcess.execFile(sfdx.path, ['--version'], function (err, stdout) {
          console.log(err)
    test.ok(stdout.trim().indexOf(sfdx.version) != -1, 'Version should be match')
    test.done()
  })
}


exports.testCleanPath = function (test) {
  test.expect(5)
  test.equal('/Users/dan/bin', sfdx.cleanPath('/Users/dan/bin:./bin'))
  test.equal('/Users/dan/bin:/usr/bin', sfdx.cleanPath('/Users/dan/bin:./bin:/usr/bin'))
  test.equal('/usr/bin', sfdx.cleanPath('./bin:/usr/bin'))
  test.equal('', sfdx.cleanPath('./bin'))
  test.equal('/Work/bin:/usr/bin', sfdx.cleanPath('/Work/bin:/Work/sdfx/node_modules/.bin:/usr/bin'))
  test.done()
}

exports.testBogusReinstallLocation = function (test) {
  util.findValidSFDXBinary('./blargh', '5.99.1-d7efd75')
  .then(function (binaryLocation) {
    test.ok(!binaryLocation, 'Expected link to fail')
    test.done()
  })
}

exports.testSuccessfulReinstallLocation = function (test) {
  util.findValidSFDXBinary(path.resolve(__dirname, '../lib/location'), '5.99.1-d7efd75')
  .then(function (binaryLocation) {
    test.ok(binaryLocation, 'Expected link to succeed')
    test.done()
  })
}