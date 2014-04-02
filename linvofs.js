/* TODO: split that file into parts
 */
var http = require("http");
var fs = require("fs");
var url = require("url");

var rangeParser = require("range-parser");
var mime = require("mime");
var pump = require("pump");

/* Backends
 */
var engine = require("torrent-stream");
engine.engines = { };

function openPath(path, cb)
{
    // length: 64 ; Linvo Hash ; TODO
    // length: 40 ; info hash
    
    var parts = path.split("/");
    if (parts[0] && parts[0].length == 40)
    {
        console.log(path);
    }
    
    cb(new Error("Cannot parse path"));
}


/* Front-end: HTTP
 */
function createServer()
{
	var server = http.createServer();

    /*
	var onready = function() {
		if (typeof index !== 'number') {
			index = e.files.reduce(function(a, b) {
				return a.length > b.length ? a : b;
			});
			index = e.files.indexOf(index);
		}

		e.files[index].select();
		server.index = e.files[index];
	};

	if (e.torrent) onready();
	else e.on('ready', onready);
*/

	server.on("request", function(request, response) {
		var u = url.parse(request.url);
        console.log("url");
        console.log(u);
		if (u.pathname === '/favicon.ico') return response.end();
		if (u.pathname === '/') u.pathname = '/'+index;
        
        openPath(u.pathname, function(err, handle)
        {
        });
        
        /*
		var i = Number(u.pathname.slice(1));

		if (isNaN(i) || i >= e.files.length) {
			response.statusCode = 404;
			response.end();
			return;
		}

		var file = e.files[i];
		var range = request.headers.range;
		range = range && rangeParser(file.length, range)[0];
		response.setHeader('Accept-Ranges', 'bytes');
		response.setHeader('Content-Type', mime.lookup(file.name));

		if (!range) {
			response.setHeader('Content-Length', file.length);
			if (request.method === 'HEAD') return response.end();
			pump(file.createReadStream(), response);
			return;
		}

		response.statusCode = 206;
		response.setHeader('Content-Length', range.end - range.start + 1);
		response.setHeader('Content-Range', 'bytes '+range.start+'-'+range.end+'/'+file.length);

		if (request.method === 'HEAD') return response.end();
		pump(file.createReadStream(range), response);
        */
    });

	return server;    
}
 
/* Front-end: FUSE
 */
// TODO

createServer().listen(7777);
