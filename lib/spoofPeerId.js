var hat = require('hat')

// we should update the IDs for the newest versions periodically

// client peer id details: https://github.com/webtorrent/bittorrent-peerid/blob/b370d052ec2ec1d13967545cbe70844efe1cc211/index.js#L249

var peerIds = [
    'qB4600',
    'DE2110',
    'AZ5770',
    'TR4040',
]

module.exports = function() {
    var peerId = peerIds[Math.floor(Math.random()*peerIds.length)]
    var newPeerId = ''
    for (var i = 0; i < peerId.length; i++) {
        if (isNaN(peerId[i])) {
            newPeerId += peerId[i]
        } else {
            var nr = parseInt(peerId[i])
            if (nr === 0) {
                newPeerId += peerId[i]
            } else {
                var min = Math.floor(nr / 2)
                newPeerId += Math.floor(Math.random() * (nr - min + 1) + min)
            }
        }
    }
    return `-${newPeerId}-${hat(48)}`
}
