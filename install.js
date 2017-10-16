/*
 * This simply fetches the right version of Salesforce DX for the current platform.
 */

'use strict'

var requestProgress = require('request-progress')
var progress = require('progress')
var decompress = require('decompress')
var decompressTarxz = require('decompress-tarxz')
var fs = require('fs-extra')
var helper = require('./lib/sfdxprebuilt')
var kew = require('kew')
var path = require('path')
var request = require('request')
var url = require('url')
var util = require('./lib/util')
var which = require('which')
var os = require('os')
var cp = require('child_process')
var gracefulFs = require('graceful-fs')
gracefulFs.gracefulify(require('fs'))

var originalPath = process.env.PATH

var checkSFDXVersion = util.checkSFDXVersion
var getTargetPlatform = util.getTargetPlatform
var getTargetArch = util.getTargetArch
var getDownloadSpec = util.getDownloadSpec
var findValidSFDXBinary = util.findValidSFDXBinary
var verifyChecksum = util.verifyChecksum
var writeLocationFile = util.writeLocationFile


// If the process exits without going through exit(), then we did not complete.
var validExit = false

process.on('exit', function () {
  if (!validExit) {
    console.log('Install exited unexpectedly')
    exit(1)
  }
})

// NPM adds bin directories to the path, which will cause `which` to find the
// bin for this package not the actual SFDX bin.  Also help out people who
// put ./bin on their path
process.env.PATH = helper.cleanPath(originalPath)

var libPath = path.join(__dirname, 'lib')
var pkgPath = path.join(libPath, 'sfdxprebuilt')
var sfdxPath = null
var manifest;

// If the user manually installed SFDX, we want
// to use the existing version.
//
// Do not re-use a manually-installed SFDX with
// a different version.
//
// Do not re-use an npm-installed SFDX, because
// that can lead to weird circular dependencies between
// local versions and global versions.
kew.resolve(true)
  .then(getManifestFromSalesforce)
  .then(trySFDXInLib)
  .then(trySFDXOnPath)
  .then(downloadSFDX)
  .then(extractDownload)
  .then(function (extractedPath) {
    return copyIntoPlace(extractedPath, pkgPath, manifest.version)
  })
  .then(function() {
    return installLib()
  })
  .then(saveLocationIfNeeded)
  .fail(function (err) {
    console.error('SFDX installation failed', err, err.stack)
    exit(1)
  })


function exit(code) {
  validExit = true
  process.env.PATH = originalPath
  process.exit(code || 0)
}

function saveLocationIfNeeded() {
    var location = getTargetPlatform() === 'win32' ?
        path.join(pkgPath, 'bin', 'sfdx.exe') :
        path.join(pkgPath, 'bin' ,'sfdx')

    try {
      // Ensure executable is executable by all users
      fs.chmodSync(location, '755')
    } catch (err) {
      if (err.code == 'ENOENT') {
        console.error('chmod failed: sfdx was not successfully copied to', location)
        exit(1)
      }
      throw err
    }

    var relativeLocation = path.relative(libPath, location)
    writeLocationFile(relativeLocation)

    console.log('Done. sfdx binary available at', location)
    exit(0)
  }

  function getManifestFromSalesforce() {
    return helper.getManifest().then(sfManifest => {
      manifest = sfManifest;
    })
  }

/**
 * Check to see if the binary in lib is OK to use. If successful, exit the process.
 */
function trySFDXInLib() {  
  return kew.fcall(function () {
    return findValidSFDXBinary(path.resolve(__dirname, './lib/location.js'), manifest.version)
  }).then(function (binaryLocation) {
    if (binaryLocation) {
      console.log('SFDX is previously installed at', binaryLocation)
      exit(0)
    }
  }).fail(function () {
    // silently swallow any errors
  })
}

/**
 * Check to see if the binary on PATH is OK to use. If successful, exit the process.
 */
function trySFDXOnPath() {
  if (getTargetPlatform() != process.platform || getTargetArch() != process.arch) {
    console.log('Building for target platform ' + getTargetPlatform() + '/' + getTargetArch() +
                '. Skipping PATH search')
    return kew.resolve(false)
  }

  return kew.nfcall(which, 'sfdx')
  .then(function (result) {
    sfdxPath = result
    console.log('Considering SFDX found at', sfdxPath)

    // Horrible hack to avoid problems during global install. We check to see if
    // the file `which` found is our own bin script.
    if (sfdxPath.indexOf(path.join('npm', 'sfdxprebuilt')) !== -1) {
      console.log('Looks like an `npm install -g` on windows; skipping installed version.')
      return
    }

    var contents = fs.readFileSync(sfdxPath, 'utf8')
    if (/NPM_INSTALL_MARKER/.test(contents)) {
      console.log('Looks like an `npm install -g`')

      var sfdxLibPath = path.resolve(fs.realpathSync(sfdxPath), '../../lib/location')
      return findValidSFDXBinary(sfdxLibPath, manifest.version)
      .then(function (binaryLocation) {
        if (binaryLocation) {
          writeLocationFile(binaryLocation)
          console.log('SFDX linked at', sfdxLibPath)
          exit(0)
        }
        console.log('Could not link global install, skipping...')
      })
    } else {
      return checkSFDXVersion(sfdxPath, manifest.version).then(function (matches) {
        if (matches) {
          writeLocationFile(sfdxPath)
          console.log('SFDX is already installed on PATH at', sfdxPath)
          exit(0)
        }
      })
    }
  }, function () {
    console.log('SFDX not found on PATH')
  })
  .fail(function (err) {
    console.error('Error checking path, continuing', err)
    return false
  })
}

function installLib() {
  var deferred = kew.defer()
  if(getTargetPlatform() === 'linux' || getTargetPlatform()  === 'darwin') {    
    var installer = pkgPath + path.sep + 'install'
    console.log('Installing SFDX using ' + installer)
    try {
      cp.execSync(installer)
    } catch(e) {
      // Try using sudo.
      cp.execSync('sudo ' + installer)
    }
    
    deferred.resolve() 
  } else {
    deferred.resolve()
  }
  
  return deferred.promise
}

/**
 * Download SFDX, reusing the existing copy on disk if available.
 * Exits immediately if there is no binary to download.
 * @return {Promise.<string>} The path to the downloaded file.
 */
function downloadSFDX() {
  var downloadSpec = getDownloadSpec(manifest)
  if (!downloadSpec) {
    console.error(
        'Unexpected platform or architecture: ' + getTargetPlatform() + '/' + getTargetArch() + '\n' +
        'It seems there is no binary available for your platform/architecture\n' +
        'Try to install SFDX globally')
    exit(1)
  }

  var downloadUrl = downloadSpec.url
  var downloadedFile

  return kew.fcall(function () {
    // Can't use a global version so start a download.
    var tmpPath = findSuitableTempDirectory()
    var fileName = downloadUrl.split('/').pop()
    downloadedFile = path.join(tmpPath, fileName)

    if (fs.existsSync(downloadedFile)) {
      console.log('Download already available at', downloadedFile)
      return verifyChecksum(downloadedFile, downloadSpec.checksum)
    }
    return false
  }).then(function (verified) {
    if (verified) {
      return downloadedFile
    }

    // Start the install.
    console.log('Downloading', downloadUrl)
    console.log('Saving to', downloadedFile)
    return requestBinary(getRequestOptions(), downloadedFile)
  })
}

function findSuitableTempDirectory() {
  var now = Date.now()
  var candidateTmpDirs = [
    process.env.npm_config_tmp,
    os.tmpdir(),
    path.join(process.cwd(), 'tmp')
  ]

  for (var i = 0; i < candidateTmpDirs.length; i++) {
    var candidatePath = candidateTmpDirs[i]
    if (!candidatePath) continue

    try {
      candidatePath = path.join(path.resolve(candidatePath), 'sfdx')
      fs.mkdirsSync(candidatePath, '0777')
      // Make double sure we have 0777 permissions; some operating systems
      // default umask does not allow write by default.
      fs.chmodSync(candidatePath, '0777')
      var testFile = path.join(candidatePath, now + '.tmp')
      fs.writeFileSync(testFile, 'test')
      fs.unlinkSync(testFile)
      return candidatePath
    } catch (e) {
      console.log(candidatePath, 'is not writable:', e.message)
    }
  }

  console.error('Can not find a writable tmp directory, please report issue ' +
      'on https://github.com/coveo/sfdx-prebuilt with as much ' +
      'information as possible.')
  exit(1)
}

function requestBinary(requestOptions, filePath) {
  var deferred = kew.defer()

  var writePath = filePath + '-download-' + Date.now()

  console.log('Receiving...')
  var bar = null
  requestProgress(request(requestOptions, function (error, response, body) {
    console.log('')
    if (!error && response.statusCode === 200) {
      fs.writeFileSync(writePath, body)
      console.log('Received ' + Math.floor(body.length / 1024) + 'K total.')
      fs.renameSync(writePath, filePath)
      deferred.resolve(filePath)

    } else if (response) {
      console.error('Error requesting archive.\n' +
          'Status: ' + response.statusCode + '\n' +
          'Request options: ' + JSON.stringify(requestOptions, null, 2) + '\n' +
          'Response headers: ' + JSON.stringify(response.headers, null, 2) + '\n' +
          'Make sure your network and proxy settings are correct.\n\n' +
          'If you continue to have issues, please report this full log at ' +
          'https://github.com/coveo/sfdx-prebuilt')
      exit(1)
    } else {
      handleRequestError(error)
    }
  })).on('progress', function (state) {
    try {
      if (!bar) {
        bar = new progress('  [:bar] :percent', {total: state.size.total, width: 40})
      }
      bar.curr = state.size.transferred
      bar.tick()
    } catch (e) {
      // It doesn't really matter if the progress bar doesn't update.
    }
  })
  .on('error', handleRequestError)

  return deferred.promise
}

function stripDir(p) {
  var ar = p.split(path.sep); ar.splice(0, false)

  return ar.join(path.sep)
}

var links = []

function filterOutSymlinks(dstPath) {
  return function(file) {
    // Workaround for https://github.com/kevva/decompress/issues/52
    if (file.type != 'link' && file.type != 'symlink') {
      return true
    }

    var newpath = path.join(dstPath, file.path)
    var linkpath = path.join(dstPath, stripDir(file.linkname))
    links.push({path: newpath, linkpath: linkpath})
    return false
  }
}

function extractDownload(filePath) {
  var deferred = kew.defer()
  // extract to a unique directory in case multiple processes are
  // installing and extracting at once
  var extractedPath = filePath + '-extract-' + Date.now()
  
  fs.mkdirsSync(extractedPath, '0777')
  // Make double sure we have 0777 permissions; some operating systems
  // default umask does not allow write by default.
  fs.chmodSync(extractedPath, '0777')

  console.log('Decompressing files')
  decompress(path.resolve(filePath), extractedPath, {
    plugins: [
        decompressTarxz()
    ],
    filter: filterOutSymlinks(extractedPath)
  }).then(function() {
      console.log('Linking files')    
      links.forEach(function(link) {
        try {
          // Try to link directly.
          gracefulFs.linkSync(link.linkpath, link.path)
        } catch (_) {
          try {
            // Try to unlink then relink.
            gracefulFs.unlinkSync(link.path)
            gracefulFs.linkSync(link.linkpath, link.path)
          } catch (e) {
            console.log('Ignoring link between ' + link.linkpath + ' and ' + link.path + ' because of exception:' + e)
          }
        }
      })

      console.log('Files decompressed')
      deferred.resolve(extractedPath)
  }).catch(function(err) {
    console.error('Error extracting tar' + err)
    deferred.reject(err)
  }) 

  return deferred.promise
}

function getRequestOptions() {
  var strictSSL = !!process.env.npm_config_strict_ssl
  if (process.version == 'v0.10.34') {
    console.log('Node v0.10.34 detected, turning off strict ssl due to https://github.com/joyent/node/issues/8894')
    strictSSL = false
  }

  var options = {
    uri: getDownloadUrl(),
    encoding: null, // Get response as a buffer
    followRedirect: true, // The default download path redirects to a CDN URL.
    headers: {},
    strictSSL: strictSSL
  }

  var proxyUrl = process.env.npm_config_https_proxy ||
      process.env.npm_config_http_proxy ||
      process.env.npm_config_proxy
  if (proxyUrl) {

    // Print using proxy
    var proxy = url.parse(proxyUrl)
    if (proxy.auth) {
      // Mask password
      proxy.auth = proxy.auth.replace(/:.*$/, ':******')
    }
    console.log('Using proxy ' + url.format(proxy))

    // Enable proxy
    options.proxy = proxyUrl
  }

  // Use the user-agent string from the npm config
  options.headers['User-Agent'] = process.env.npm_config_user_agent

  // Use certificate authority settings from npm
  var ca = process.env.npm_config_ca
  if (!ca && process.env.npm_config_cafile) {
    try {
      ca = fs.readFileSync(process.env.npm_config_cafile, {encoding: 'utf8'})
        .split(/\n(?=-----BEGIN CERTIFICATE-----)/g)

      // Comments at the beginning of the file result in the first
      // item not containing a certificate - in this case the
      // download will fail
      if (ca.length > 0 && !/-----BEGIN CERTIFICATE-----/.test(ca[0])) {
        ca.shift()
      }

    } catch (e) {
      console.error('Could not read cafile', process.env.npm_config_cafile, e)
    }
  }

  if (ca) {
    console.log('Using npmconf ca')
    options.agentOptions = {
      ca: ca
    }
    options.ca = ca
  }

  return options
}

function handleRequestError(error) {
  if (error && error.stack && error.stack.indexOf('SELF_SIGNED_CERT_IN_CHAIN') != -1) {
      console.error('Error making request, SELF_SIGNED_CERT_IN_CHAIN. ' +
          'Please read https://github.com/coveo/sfdx-prebuilt')
      exit(1)
  } else if (error) {
    console.error('Error making request.\n' + error.stack + '\n\n' +
        'Please report this full log at https://github.com/coveo/sfdx-prebuilt')
    exit(1)
  } else {
    console.error('Something unexpected happened, please report this full ' +
        'log at https://github.com/coveo/sfdx-prebuilt')
    exit(1)
  }
}

/**
 * @return {?string} Get the download URL for sfdx.
 *     May return null if no download url exists.
 */
function getDownloadUrl() {
  var spec = getDownloadSpec(manifest)
  return spec && spec.url
}

function copyIntoPlace(extractedPath, targetPath, version) {
  console.log('Removing', targetPath)
  return kew.nfcall(fs.remove, targetPath).then(function () {
    // Look for the extracted directory, so we can rename it.
    var files = fs.readdirSync(extractedPath)
    for (var i = 0; i < files.length; i++) {
      var file = path.join(extractedPath, files[i])
      if (fs.statSync(file).isDirectory() && file.indexOf(version) != -1) {
        console.log('Copying extracted folder', file, '->', targetPath)
        return kew.nfcall(fs.move, file, targetPath)
      }
    }

    console.log('Could not find extracted file', files)
    throw new Error('Could not find extracted file')
  })
}