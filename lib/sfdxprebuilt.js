var fs = require('fs')
var path = require('path')
var request = require('request')


var manifest;

/**
 * The version of sfdx installed by this package.
 * @type {number}
 */
exports.getVersion = function() {
  return getManifest().then(manifest => {
    return manifest.version;
  })
};

var getManifest = function() {
  return new Promise((resolve, reject) => {
    if(manifest) {
      resolve(manifest)
      return
    } else {      
      request.get('https://developer.salesforce.com/media/salesforce-cli/manifest.json', (error, response, body) => {
        if(!error && response.statusCode === 200) {
          manifest = JSON.parse(body);
          resolve(manifest)
        } else {
          reject(response)
        }        
      })
    }
  });
};

exports.getManifest = getManifest;


/**
 * Where the sfdx binary can be found.
 * @type {string}
 */
try {
  var location = require('./location')
  var sfdxPath=''
  //Handle win32 requirement for path
  if(location.platform === 'win32') {
    sfdxPath='"'
  }
  sfdxPath += path.resolve(__dirname, location.location) + sfdxPath
  exports.path = sfdxPath
  exports.platform = location.platform

  exports.arch = location.arch
} catch(e) {
  // Must be running inside install script.
  exports.path = null
}

/**
 * Returns a clean path that helps avoid `which` finding bin files installed
 * by NPM for this repo.
 * @param {string} path
 * @return {string}
 */
exports.cleanPath = function (path) {
  return path
      .replace(/:[^:]*node_modules[^:]*/g, '')
      .replace(/(^|:)\.\/bin(\:|$)/g, ':')
      .replace(/^:+/, '')
      .replace(/:+$/, '')
}

// Make sure the binary is executable.  For some reason doing this inside
// install does not work correctly, likely due to some NPM step.
if (exports.path) {
  try {
    // avoid touching the binary if it's already got the correct permissions
    var st = fs.statSync(exports.path)
    var mode = st.mode | parseInt('0555', 8)
    if (mode !== st.mode) {
      fs.chmodSync(exports.path, mode)
    }
  } catch (e) {
    // Just ignore error if we don't have permission.
    // We did our best. Likely because sfdx was already installed.
  }
}