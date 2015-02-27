/* TODO: split that file into parts
 */
var http = require("http");
var fs = require("fs");
var url = require("url");
var os = require("os");
var events = require("events");

var rangeParser = require("range-parser");
var mime = require("mime");
var pump = require("pump");

var request = require("request");
var byline = require("byline");

var _  = require("lodash");

var EngineFS =  new events.EventEmitter();


// engine

// stream-open
// stream-close
// stream-inactive stream-inactive:hash:idx

// stream-cached stream-cached:hash:idx
// stream-progress stream-progress:hash:idx
 
// engine-created

// engine-active
// engine-idle
// engine-inactive

// TODO Provide option for those to be changed
var STREAM_TIMEOUT = 10*1000; // how long must a stream be unused to be considered 'inactive'
var ENGINE_TIMEOUT = 10*60*60*1000; 

var engines = EngineFS.engines = {};

var defaultOptions = {
    /* Options */
    connections: os.cpus().length > 1 ? 100 : 30,
    virtual: true
};

function createEngine(infoHash, options, cb)
{
    if (! module.exports.engine) throw new Error("EngineFS requires EngineFS.engine to point to engine constructor");

    var cb = cb || function() { };

    if (options.torrent && Array.isArray(options.torrent)) options.torrent = new Buffer(options.torrent);
    if (options.torrent && typeof(options.torrent)=="string") options.torrent = new Buffer(options.torrent, "base64");

    var torrent = options.torrent || "magnet:?xt=urn:btih:"+infoHash;

    var e = engines[infoHash] = engines[infoHash] || module.exports.engine(torrent, options);
    e.swarm.resume(); // In case it's paused
    e.ready(function() { cb(null, e) });
    
    EngineFS.emit("engine-created", e);
 
    return e;
}

function openPath(path, cb)
{
    // length: 40 ; info hash
    var parts = path.split("/").filter(function(x) { return x });
    if (parts[0] && parts[0].length == 40)
    {
        var infoHash = parts[0];
		var i = Number(parts[1]);

		if (isNaN(i)) return cb(new Error("Cannot parse path: info hash received, but invalid file index"));
        
        createEngine(infoHash, defaultOptions, function(err, engine)
        {
            if (err) return cb(err);
            if (! engine.files[i]) return cb(new Error("Torrent does not contain file with index "+i));
            
            cb(null, engine.files[i], engine);
        });
        return;
    }
    
    // length: 64 ; Linvo Hash ; TODO
    if (parts[0] && parts[0].length == 64)
    {
        /* Large TODO
         */
        return cb(new Error("Not implemented yet"));
    }
    
    cb(new Error("Cannot parse path"));
}

/* Front-end: HTTP
 */
function createServer(port)
{
	var server = http.createServer();

	server.on("request", function(request, response) {
		var u = url.parse(request.url);

		if (u.pathname === "/favicon.ico") return response.end();
        if (u.pathname === "/stats.json") return response.end(JSON.stringify(_.map(engines, getStatistics)));
        
        openPath(u.pathname, function(err, handle, e)
        {
            if (err) { console.error(err); response.statusCode = 500; return response.end(); }
            
            // Handle LinvoFS events
            EngineFS.emit("stream-open", e.infoHash, e.files.indexOf(handle), e);
            var emitClose = function() { EngineFS.emit("stream-close", e.infoHash, e.files.indexOf(handle), e) };
            response.on("finish", emitClose);
            response.on("close", emitClose);

            request.connection.setTimeout(24*60*60*1000);
            //request.connection.setTimeout(0);

            var range = request.headers.range;
            range = range && rangeParser(handle.length, range)[0];
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Content-Type", mime.lookup(handle.name));
            response.setHeader("Cache-Control", "max-age=0, no-cache");
            
            // CORS? research in peerflix - https://github.com/mafintosh/peerflix/blob/master/index.js
            // https://github.com/mafintosh/peerflix/commit/1ff1540d8b200b43064db51a043f885f79e14868 
            // CORS for chromecast - https://github.com/mafintosh/peerflix/commit/9f22fb17ec7bc747f7b7dfa0e80951a638713220
            // CORS byte ranges - https://github.com/mafintosh/peerflix/commit/4bf42ee93eabf679410797c54f65f49d36cf3410
            //response.setHeader("Access-Control-Max-Age", "1728000");

            if (!range) {
                response.setHeader("Content-Length", handle.length);
                if (request.method === "HEAD") return response.end();
                pump(handle.createReadStream(), response);
                return;
            }

            response.statusCode = 206;
            response.setHeader("Content-Length", range.end - range.start + 1);
            response.setHeader("Content-Range", "bytes "+range.start+"-"+range.end+"/"+handle.length);

            if (request.method === "HEAD") return response.end();
            pump(handle.createReadStream(range), response);  
        });
    });
	
	if (port) server.listen(port);
	return server;    
};
 
/* Front-end: FUSE
 */
// TODO


function getStatistics(e)
{
    return {
        peers: e.swarm.wires.length,
        unchoked: e.swarm.wires.filter(function(peer) { return !peer.peerChoking }).length,
        queued: e.swarm.queued,
        unique: Object.keys(e.swarm._peers).length,

        files: e.torrent && e.torrent.files,

        downloaded: e.swarm.downloaded,
        uploaded: e.swarm.uploaded,

        downloadSpeed: e.swarm.downloadSpeed(),
        uploadSpeed: e.swarm.downloadSpeed(),

        dht: !!e.dht,
        dhtPeers: e.dht ? Object.keys(e.dht.peers).length : null,
        dhtVisited: e.dht ? Object.keys(e.dht.visited).length : null
    };
}


/*
* Emit events
* stream-cached:fileID filePath
* stream-progress:fileID filePath percent 
*/
EngineFS.on("stream-open", function(infoHash, fileIndex, e)
{
    var file = e.torrent.files[fileIndex];
    if (file.__cacheEvents) return;
    file.__cacheEvents = true;

    var startPiece = (file.offset / e.torrent.pieceLength) | 0;
    var endPiece = ((file.offset+file.length-1) / e.torrent.pieceLength) | 0;
    var fpieces = [ ];
    for (var i=startPiece; i<=endPiece; i++) if (! e.bitfield.get(i)) fpieces.push(i);
    var filePieces = Math.ceil(file.length / e.torrent.pieceLength);
    
    var onDownload = function(p) { 
        // remove from array
        if (p !== undefined) {
            var idx = fpieces.indexOf(p);
            if (idx == -1) return;
            fpieces.splice(idx, 1);
        }

        EngineFS.emit("stream-progress:"+infoHash+":"+fileIndex, (filePieces-fpieces.length)/filePieces, fpath);

        if (fpieces.length) return;

        var fpath = e.store.getDest(fileIndex);
        EngineFS.emit("stream-cached:"+infoHash+":"+fileIndex, fpath);
        EngineFS.emit("stream-cached", infoHash, fileIndex, fpath);

        e.removeListener("download", onDownload);
        e.removeListener("verify", onDownload);
    };
    //e.on("download", onDownload); // only consider verified pieces downloaded, 
    e.on("verify", onDownload);  // since last torrent-stream only verify guarantees that piece is written

    onDownload(); // initial call in case file is already done

    /* New torrent-stream writes pieces only when they're verified, which means virtuals are
     * not going to be written down, which means we have a change to play a file without having it
     * fully commited to disk; make sure we do that by downloading the entire file in verified pieces 
     * 
     * Plus, we always guarantee we have the whole file requested
     */
    var startPiece = (file.offset / e.torrent.realPieceLength) | 0;
    var endPiece = ((file.offset+file.length-1) / e.torrent.realPieceLength) | 0;
    var ratio = e.torrent.realPieceLength / e.torrent.pieceLength;
    e.select(startPiece*ratio, (endPiece+1)*ratio, false);
});


/*  
 * More events wiring: stream-inactive, engine-active, engine-idle, engine-inactive
 */
function Emit(args)
{
    // Allow us to listen to events for a specific stream as well as in general (e.g. stream-close(hash,idx) vs stream-close:hash:idx)
    EngineFS.emit.apply(EngineFS, args);
    EngineFS.emit(args.join(":"));
};

// Increment/decrement a counter on `incEv`/`decEv`; generate the ID of the counter with `idFn`
// Calls `onPositive` when counter is >0 and `onZero` when counter has stayed on 0 for `timeout` milliseconds
function Counter(incEv, decEv, idFn, onPositive, onZero, timeout)
{
    var counter = {}, timeouts = {};
    EngineFS.on(incEv, function(hash, idx) {
        var id = idFn(hash, idx);
        if (! counter.hasOwnProperty(id)) { counter[id] = 0; onPositive(hash, idx); }
        counter[id]++;

        if (timeouts[id]) {
            clearTimeout(timeouts[id]);
            delete timeouts[id];
        };
    });
    EngineFS.on(decEv, function(hash, idx) {
        var id = idFn(hash, idx);
        counter[id]--;
        if (counter[id] == 0) {
            if (timeouts[id]) clearTimeout(timeouts[id]);
            timeouts[id] = setTimeout(function() { 
                onZero(hash, idx); 
                delete counter[id]; delete timeouts[id];
            }, timeout);
        };
    });
};

new Counter("stream-open", "stream-close", function(hash, idx) { return hash+":"+idx }, function(hash, idx) { 
    Emit(["stream-active",hash,idx])
}, function(hash, idx) {  
    Emit(["stream-inactive",hash,idx])
}, STREAM_TIMEOUT);

new Counter("stream-open", "stream-close", function(hash, idx) { return hash }, function(hash) {
    Emit(["engine-active",hash]);
}, function(hash) {  
    Emit(["engine-inactive",hash]);
}, ENGINE_TIMEOUT); // Keep engines active for STREAM_TIMEOUT * 60

new Counter("stream-active", "stream-cached", function(hash, idx) { return hash }, function() { }, function(hash) {  
    Emit(["engine-idle",hash]);
}, STREAM_TIMEOUT);


module.exports = EngineFS;
module.exports.http = createServer;
// FUSE: TODO

module.exports.create = createEngine;

