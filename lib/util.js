var cp = require('child_process')
var fs = require('fs-extra')
var hasha = require('hasha')
var kew = require('kew')
var path = require('path')
var libPath = __dirname

/**
 * Given a lib/location file of a SFDX previously installed with NPM,
 * is there a valid SFDX binary at this lib/location.
 * @return {Promise<string>} resolved location of SFDX binary on success
 */
function findValidSFDXBinary(libPath, version) {
  return kew.fcall(function () {
    var libModule = require(libPath)
    if (libModule.location &&
        getTargetPlatform() == libModule.platform &&
        getTargetArch() == libModule.arch) {
      var resolvedLocation = path.resolve(path.dirname(libPath), libModule.location)
      if (fs.statSync(resolvedLocation)) {
        return checkSFDXVersion(resolvedLocation, version).then(function (matches) {
          if (matches) {
            return kew.resolve(resolvedLocation)
          }
        })
      }
    }
    return false
  }).fail(function () {
    return false
  })
}

/**
 * Check to make sure a given binary is the right version.
 * @return {kew.Promise.<boolean>}
 */
function checkSFDXVersion(sfdxPath, version) {
  console.log('Found SFDX at', sfdxPath, '...verifying')
  return kew.nfcall(cp.execFile, sfdxPath, ['--version']).then(function (stdout) {
    var longVersion = stdout.trim()
    if(longVersion === undefined) {
        console.log('SFDX --version is empty', stdout.trim(), '@', sfdxPath + '.')
        return false
    }
    var versionRegex = /sfdx-cli\/([0-9\.a-zA-Z\-]+)\s/
    var matches = versionRegex.exec(longVersion)
    if(matches.length < 1) {
        console.log('SFDX detected, but could not extract version', stdout.trim(), '@', sfdxPath + '.')
        return false
    }

    // get the first capturing group.
    var actualVersion = matches[1]

    if (actualVersion == version) {
      return true
    } else {
      console.log('SFDX detected, but wrong version', stdout.trim(), '@', sfdxPath + '.')
      return false
    }
  }).fail(function (err) {
    console.error('Error verifying SFDX, continuing', err)
    return false
  })
}


/**
 * @return {string}
 */
function getTargetPlatform() {
  return process.env.SFDX_PLATFORM || process.platform
}

/**
 * @return {string}
 */
function getTargetArch() {
  return process.env.SFDX_ARCH || process.arch
}

/**
 * Writes the location file with location and platform/arch metadata about the
 * binary.
 */
function writeLocationFile(location) {
  console.log('Writing location.js file')
  if (getTargetPlatform() === 'win32') {
    location = location.replace(/\\/g, '\\\\')
  }

  var platform = getTargetPlatform()
  var arch = getTargetArch()

  var contents = 'module.exports.location = "' + location + '"\n'

  if (/^[a-zA-Z0-9]*$/.test(platform) && /^[a-zA-Z0-9]*$/.test(arch)) {
    contents +=
        'module.exports.platform = "' + getTargetPlatform() + '"\n' +
        'module.exports.arch = "' + getTargetArch() + '"\n'
  }

  fs.writeFileSync(path.join(libPath, 'location.js'), contents)
}

/**
 * @return {?{url: string, checksum: string}} Get the download URL and expected
 *     SHA-256 checksum for SFDX.  May return null if no download url exists.
 * https://developer.salesforce.com/media/salesforce-cli/manifest.json
 */
function getDownloadSpec(manifest) {
  var buildTarget

  var platform = getTargetPlatform()
  var arch = getTargetArch()
  if (platform === 'linux' && arch === 'x64') {    
    buildTarget = 'linux-amd64'
  } else if (platform === 'linux' && arch == 'ia32') {
    buildTarget = 'linux-386'
  } else if (platform === 'darwin') {
    buildTarget = 'darwin-amd64'
  } else if (platform === 'win32' && arch === 'x64') {
    buildTarget = 'windows-amd64'    
  } else if (platform === 'win32' && arch === 'ia32') {
    buildTarget = 'windows-386'
  } 
  else {
    return null
  }

  var build = manifest.builds[buildTarget]

  return {url: build.url, checksum: build.sha256}
}

/**
 * Check to make sure that the file matches the checksum.
 * @param {string} fileName
 * @param {string} checksum
 * @return {Promise.<boolean>}
 */
function verifyChecksum(fileName, checksum) {
  return kew.resolve(hasha.fromFile(fileName, {algorithm: 'sha256'})).then(function (hash) {
    var result = checksum == hash
    if (result) {
      console.log('Verified checksum of previously downloaded file')
    } else {
      console.log('Checksum did not match')
    }
    return result
  }).fail(function (err) {
    console.error('Failed to verify checksum: ', err)
    return false
  })
}

module.exports = {
  checkSFDXVersion: checkSFDXVersion,
  getDownloadSpec: getDownloadSpec,
  getTargetPlatform: getTargetPlatform,
  getTargetArch: getTargetArch,
  findValidSFDXBinary: findValidSFDXBinary,
  verifyChecksum: verifyChecksum,
  writeLocationFile: writeLocationFile
}