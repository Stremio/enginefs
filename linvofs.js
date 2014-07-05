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

var _  = require("underscore");

var LinvoFS = { };
_.extend(LinvoFS, new events.EventEmitter());


/* Backend
 */
var engine = require("torrent-stream");
engine.engines = { };
var stats = {};

var defaultOptions = {
    /* Options */
    connections: os.cpus().length > 1 ? 100 : 30,
    virtual: true
};

function createEngine(infoHash, options, cb)
{
    var cb = cb || function() { };

    if (options.torrent && Array.isArray(options.torrent)) options.torrent = new Buffer(options.torrent);

    var torrent = options.torrent || "magnet:?xt=urn:btih:"+infoHash;
    var e = engine.engines[infoHash] = engine.engines[infoHash] || engine(torrent, options);

    if (options.peers) options.peers.forEach(function(p) { e.connect(p) });
    if (options.peerStream) byline(request(options.peerStream)).on("data", function(d) { e.connect(d.toString()) });

    if (e.torrent) cb(null, e);
    else e.on("ready", function() { cb(null, e) });
    
    LinvoFS.emit("torrentEngine", infoHash, e);
 
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
        
        openPath(u.pathname, function(err, handle, e)
        {
            if (err) { console.error(err); response.statusCode = 500; return response.end(); }
            
            // Handle LinvoFS events
            LinvoFS.emit("opened", e.infoHash, e.files.indexOf(handle), e);
            response.on("finish", function() { LinvoFS.emit("closed", e.infoHash, e.files.indexOf(handle), e) });

            request.connection.setTimeout(24*60*60*1000);
            //request.connection.setTimeout(0);

            var range = request.headers.range;
            range = range && rangeParser(handle.length, range)[0];
            response.setHeader("Accept-Ranges", "bytes");
            response.setHeader("Content-Type", mime.lookup(handle.name));

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
}
 
/* Front-end: FUSE
 */
// TODO


/*
* Update torrent-stream stats periodically
* TODO: do that in torrent-stream thread
*/
var active = {};
LinvoFS.on("opened", function(hash) { active[hash] = true });
LinvoFS.on("closed", function(hash) { delete active[hash] });
setInterval(function() {
    for (hash in engine.engines)
    {
        if (! active[hash]) return;

        var e = engine.engines[hash];
        LinvoFS.emit("stats:"+hash, {
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
        });
    };
}, 50);


LinvoFS.on("opened", function(infoHash, fileIndex, e)
{
    /*
    * Emit events
    * cached:fileID filePath
    * cachedProgress:fileID filePath percent 
    */

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
        var idx = fpieces.indexOf(p);
        if (idx == -1) return;
        fpieces.splice(idx, 1);

        LinvoFS.emit("cachedProgress:"+infoHash+":"+fileIndex, (filePieces-fpieces.length)/filePieces, fpath);

        if (fpieces.length) return;

        var fpath = e.store.getDest(resp.torrentIndex);
        LinvoFS.emit("cached:"+infoHash+":"+fileIndex, fpath);

        e.removeListener("download", onDownload);
    };
    e.on("download", onDownload);
});



module.exports = LinvoFS;
module.exports.http = createServer;
// FUSE: TODO

module.exports.createTorrentEngine = createEngine;
module.exports.stats = stats;

if (process.send) 
{
	var dnode = require("dnode");
	var server = dnode(LinvoFS, { /*emit: "object", */ weak:false }); // Don't emit as objects; Node IPC uses JSON serialization either way, and still loses special objects - e.g. Date and Buffer

	server.on("data", function(d) { if (process.send) process.send(d) });
	process.on("message", function(msg) { server.write(msg) });
}

