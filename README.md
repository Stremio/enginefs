# enginefs
Simple layer to use and manage torrent-stream engines and access them through HTTP / FUSE. 

Somewhat similar to peerflix-server, but allows more sophisticated management, such as automatically closing torrent-stream's after some time of inactivity, etc.

Wishlist:
* HLS support - allow live transcoding to HLS
* FUSE support

# Example:
```javascript
var enginefs = require("enginefs");

// Set engine - standard torrent-stream would do the trick
enginefs.engine = require("torrent-stream");

// After 20s of inactivity we consider a HTTP stream to be inactive, and if an engine (infoHash) has had no active streams for 2 minutes we destroy it
enginefs.STREAM_TIMEOUT = 20*1000;
enginefs.ENGINE_TIMEOUT = 2*60*1000;

// Init the server, try different ports
var server = enginefs.http();
server.listen(10000);

server.on("listening", function() {
    enginefs.baseUrlLocal = "http://localhost:" + server.address().port;
    enginefs.baseUrl = "http://localhost:" + server.address().port;
    console.log("EngineFS server started at " + enginefs.baseUrl);
});

// You can use middlewares
enginefs.middleware(function(path, req, res, next) {
    console.log("-> "+req.url); // Logging purposes
    next();
});

// Init an engine when we request it
enginefs.on("request", function(hash) {
    enginefs.create(hash, {
        path: os.tmpdir() + '/' + hash,
        // put any torrent-stream parameters in here, like path
        peerSearch: { min: 40, max: 150, cooloff_time: 30, cooloff_requests: 15, sources: [ "dht:"+hash ] }
    })
});

// Stream Big Buck Bunny
// vlc http://localhost:10000/2f24d03eab998ca672b8c1ef567a184609236c02/0

// Stream Wizard Of Oz
// vlc http://localhost:10000/24c8802e2624e17d46cd555f364debd949f2c81e/0
```
