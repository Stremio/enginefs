/* TODO: split that file into parts
 */
var http = require("http");
var fs = require("fs");
var url = require("url");
var os = require("os");
var events = require("events");

var rangeParser = require("range-parser");
var bodyParser = require("body-parser");
var mime = require("mime");
var pump = require("pump");

var PeerSearch = require("peer-search");

var byline = require("byline");

var _  = require("lodash");
var async = require("async");

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
EngineFS.STREAM_TIMEOUT = 30*1000; // how long must a stream be unused to be considered 'inactive'
EngineFS.ENGINE_TIMEOUT = 60*1000; 

var engines = {};

function createEngine(infoHash, options, cb)
{
    if (! module.exports.engine) throw new Error("EngineFS requires EngineFS.engine to point to engine constructor");

    var cb = cb || function() { };

    var torrent = options.torrent || "magnet:?xt=urn:btih:"+infoHash;

    var isNew = !engines[infoHash];
    var e = engines[infoHash] = engines[infoHash] || module.exports.engine(torrent, options);
    e.swarm.resume(); // In case it's paused

    if (isNew && options.peerSearch) new PeerSearch(options.peerSearch.sources, e.swarm, options.peerSearch);
    if (isNew && options.swarmCap) e.on("download", function() {
        var unchoked = e.swarm.wires.filter(function(peer) { return !peer.peerChoking }).length;
        if (e.swarm.downloadSpeed() > options.swarmCap.maxSpeed && unchoked > options.swarmCap.minPeers) e.swarm.pause();
        else e.swarm.resume();
    });
    
    if (isNew) Emit(["engine-created", infoHash]);
    e.ready(function() { EngineFS.emit("engine-ready:"+infoHash, e.torrent); EngineFS.emit("engine-ready", infoHash, e.torrent); })
}

function getEngine(infoHash) 
{
    return engines[infoHash.toLowerCase()]; 
}

function existsEngine(infoHash)
{
    return !!engines[infoHash.toLowerCase()]; 
}

function removeEngine(infoHash)
{
    engines[infoHash].destroy();
    delete engines[infoHash];
}

function settingsEngine(infoHash, settings) 
{
   var e = engines[infoHash];
   if (!e) return;
   if (settings.hasOwnProperty("writeQueue")) e.ready(function() {
        if (settings.writeQueue == "PAUSE") { 
            e.store.writequeue.pause(); 
            setTimeout(function() { e.store.writequeue.resume() }, 50*1000); // Done for safety reasons
        }
        else e.store.writequeue.resume(); // no need for ready, since it's by default resumed
   });
   
   if (settings.swarm == "PAUSE") e.swarm.pause();
   if (settings.swarm == "RESUME") e.swarm.resume();
}

function statsEngine(infoHash, idx)
{
    if (!engines[infoHash]) return;
    return getStatistics(engines[infoHash], idx);
}

function listEngines()
{
    return Object.keys(engines);
}

function requestEngine(infoHash, cb) 
{
    if (engines[infoHash]) return engines[infoHash].ready(function() { cb(null, engines[infoHash]) });

    EngineFS.emit("request", infoHash);
    EngineFS.once("engine-created:"+infoHash, function() {
        if (engines[infoHash]) engines[infoHash].ready(function(){ cb(null, engines[infoHash]) });
    });
}

var middlewares = [];
function installMiddleware(middleware) 
{
    middlewares.push(middleware);
}

// TODO: in order to be abstract, replace req/res
function tryMiddleware(path, req, res, cb)
{
    async.eachSeries(middlewares, function(middleware, callback) { 
        if (typeof(middleware) != "function") return callback(); // consider warning here
        middleware(path, req, res, callback);
    }, cb);
}

// Emulate opening a stream
function prewarmStream(hash, idx)
{
    //EngineFS.emit("stream-open", hash, idx);
    if (engines[hash]) engines[hash].ready(function() { engines[hash].files[idx].select() }); // select without priority so we start downloading
};

function openPath(path, cb)
{
    // length: 40 ; info hash
    var parts = path.split("/").filter(function(x) { return x });
    if (parts[0] && parts[0].length == 40)
    {
        var infoHash = parts[0];
        var i = Number(parts[1]);

        if (isNaN(i)) return cb(new Error("Cannot parse path: info hash received, but invalid file index"));
        
        requestEngine(infoHash, function(err, engine)
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
    var parser = bodyParser.json();

    function onRequest(request, response) {
        var u = url.parse(request.url);

        if (sendCORSHeaders(request, response)) return;

        if (u.pathname === "/favicon.ico") return response.end();
        if (u.pathname === "/stats.json") return response.end(JSON.stringify(_.map(engines, getStatistics)));

        tryMiddleware(u.pathname, request, response, function(stream) {
            if (stream && stream.pipe) {
                if (sendDLNAHeaders(request, response)) return;
                stream.pipe(response);
                return;
            }
            else if (stream) {
                return;
            }

            openPath(u.pathname, function(err, handle, e)
            {
                if (err) { console.error(err); response.statusCode = 500; return response.end(); }
                
                // Handle LinvoFS events
                EngineFS.emit("stream-open", e.infoHash, e.files.indexOf(handle));
                var emitClose = function() { EngineFS.emit("stream-close", e.infoHash, e.files.indexOf(handle)) };
                response.on("finish", emitClose);
                response.on("close", emitClose);

                request.connection.setTimeout(24*60*60*1000);
                //request.connection.setTimeout(0);

                var range = request.headers.range;
                range = range && rangeParser(handle.length, range)[0];
                response.setHeader("Accept-Ranges", "bytes");
                response.setHeader("Content-Type", mime.lookup(handle.name));
                response.setHeader("Cache-Control", "max-age=0, no-cache");

                if (sendDLNAHeaders(request, response)) return;

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
    };
    server.on("request", function(req, res) {
        parser(req, res, function() { onRequest(req, res) });
    });
    
    if (port) server.listen(port);
    return server;    
};

function sendCORSHeaders(req, res)
{
    // Allow CORS requests to specify byte ranges.
    // The `Range` header is not a "simple header", thus the browser
    // will first send OPTIONS request and check Access-Control-Allow-Headers
    // before allowing additional requests.

    if (req.method === 'OPTIONS' && req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Range');
        res.setHeader('Access-Control-Max-Age', '1728000');

        res.end();
        return true;
    }

    if(req.headers.origin) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    }
} 

function sendDLNAHeaders(req, res)
{
    res.setHeader("transferMode.dlna.org", "Streaming");
    res.setHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=017000 00000000000000000000000000");
}

/* Front-end: FUSE
 */
// TODO


function getStatistics(e, idx)
{
    var s = {
        peers: e.swarm.wires.length,
        unchoked: e.swarm.wires.filter(function(peer) { return !peer.peerChoking }).length,
        queued: e.swarm.queued,
        unique: Object.keys(e.swarm._peers).length,

        files: e.torrent && e.torrent.files,

        downloaded: e.swarm.downloaded,
        uploaded: e.swarm.uploaded,

        downloadSpeed: e.swarm.downloadSpeed(),
        uploadSpeed: e.swarm.downloadSpeed(),
        
        sources: e.swarm.peerSearch && e.swarm.peerSearch.stats(),
        
        dht: !!e.dht,
        dhtPeers: e.dht ? Object.keys(e.dht.peers).length : null,
        dhtVisited: e.dht ? Object.keys(e.dht.visited).length : null
    };
    // TODO: better stream-specific data; e.g. download/uploaded should only be specific to this stream
    if (typeof(idx) == "number" && e.torrent && e.torrent.files[idx]) {
        s.streamLen = e.torrent.files[idx].length;
    };
    return s;
}


/*
* Emit events
* stream-cached:fileID filePath
* stream-progress:fileID filePath percent 
*/
EngineFS.on("stream-open", function(infoHash, fileIndex) { var e = getEngine(infoHash); e.ready(function() 
{
    var file = e.torrent.files[fileIndex];
    if (file.__cacheEvents) return;
    file.__cacheEvents = true;
    EngineFS.emit("stream-created", infoHash, fileIndex);

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
}) });


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
}, EngineFS.STREAM_TIMEOUT);

new Counter("stream-open", "stream-close", function(hash, idx) { return hash }, function(hash) {
    Emit(["engine-active",hash]);
}, function(hash) {  
    Emit(["engine-inactive",hash]);
}, EngineFS.ENGINE_TIMEOUT); // Keep engines active for STREAM_TIMEOUT * 60

new Counter("stream-created", "stream-cached", function(hash, idx) { return hash }, function() { }, function(hash) {  
    Emit(["engine-idle",hash]);
}, EngineFS.STREAM_TIMEOUT);


module.exports = EngineFS;
module.exports.http = createServer;
// FUSE: TODO

module.exports.sendCORSHeaders = sendCORSHeaders;
module.exports.sendDLNAHeaders = sendDLNAHeaders;

module.exports.create = createEngine;
//module.exports.get = getEngine;
module.exports.exists = existsEngine;
module.exports.remove = removeEngine;
module.exports.settings = settingsEngine;
module.exports.stats = statsEngine;
module.exports.list = listEngines;

module.exports.prewarmStream = prewarmStream;

module.exports.middleware = installMiddleware;
