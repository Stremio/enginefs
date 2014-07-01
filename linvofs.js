/* TODO: split that file into parts
 */
var http = require("http");
var fs = require("fs");
var url = require("url");
var os = require("os");

var rangeParser = require("range-parser");
var mime = require("mime");
var pump = require("pump");

/* Backend
 */
var engine = require("torrent-stream");
engine.engines = { };

var defaultOptions = {
    /* Options */
    connections: os.cpus().length > 1 ? 100 : 30,
    virtual: true
};

function createEngine(infoHash, options, cb)
{
    var cb = cb || function() { };

    var torrent = options.torrent || "magnet:?xt=urn:btih:"+infoHash;
    var e = engine.engines[infoHash] = engine.engines[infoHash] || engine(torrent, options);
    
    if (e.torrent) return cb(null, e);
    e.on("ready", function() { cb(null, e) });
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
            
            cb(null, engine.files[i]);
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
function createServer()
{
	var server = http.createServer();

	server.on("request", function(request, response) {
		var u = url.parse(request.url);

		if (u.pathname === "/favicon.ico") return response.end();
        
        openPath(u.pathname, function(err, handle)
        {
            if (err) { console.error(err); response.statusCode = 500; return response.end(); }
            
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

	return server;    
}
 
/* Front-end: FUSE
 */
// TODO

/*
* TODO: emit events
* fileCached fileID
* fileProgress percent fileID
* or maybe have that in torrent-stream first?
* 
* this would read files from .torrent, create an array of required pieces for each file,
* subscribe to the piece downloaded event, and take out those pieces frm the arrays.
*/

module.exports = {
    http: createServer,
    // fuse: TODO,
    createTorrentEngine: createEngine
};
