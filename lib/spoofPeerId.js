var hat = require('hat')

// we should update the IDs for the newest versions periodically

var peerIds = [
    // qBittorrent details: https://github.com/webtorrent/bittorrent-peerid/blob/b370d052ec2ec1d13967545cbe70844efe1cc211/index.js#L306
    'qB4600',

    // Deluge details: https://github.com/webtorrent/bittorrent-peerid/blob/b370d052ec2ec1d13967545cbe70844efe1cc211/index.js#L273
    'DE2110',

    // Vuze details: https://github.com/webtorrent/bittorrent-peerid/blob/b370d052ec2ec1d13967545cbe70844efe1cc211/index.js#L257
    'AZ5770',

    // Transmission details: https://github.com/webtorrent/bittorrent-peerid/blob/b370d052ec2ec1d13967545cbe70844efe1cc211/index.js#L323
    'TR4040',

]

module.exports = function() {
    var peerId = peerIds[Math.floor(Math.random()*peerIds.length)]
    return `-${peerId}-${hat(48)}`
}
