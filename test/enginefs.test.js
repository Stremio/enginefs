var test = require("node:test");
var assert = require("node:assert");
var Readable = require("stream").Readable;
var EventEmitter = require("events").EventEmitter;

var EngineFS = require("../enginefs");
var guessFileIdx = require("../lib/guessFileIdx");

var PIECE = 100;

// minimal stand-in for a torrent-stream engine, enough for the HTTP routes and stats
function fakeEngine(infoHash, files, opts)
{
    opts = opts || {};
    var e = new EventEmitter();
    var offset = 0;
    files = files.map(function(f) {
        var file = {
            name: f.name, path: f.name, length: f.length, offset: f.offset !== undefined ? f.offset : offset,
            select: function() { },
            createReadStream: function(range) {
                var start = (range && range.start) || 0;
                var end = range && range.end !== undefined ? range.end : f.length - 1;
                return Readable.from([Buffer.alloc(end - start + 1, 97)]);
            }
        };
        offset += f.length;
        return file;
    });
    e.infoHash = infoHash;
    e.files = files;
    e.torrent = { name: "test", pieceLength: PIECE, files: files };
    e.bitfield = { get: function() { return !!opts.complete } };
    e.selection = [];
    e.store = { };
    e.select = function() { };
    e.ready = function(cb) { setImmediate(cb) };
    e.destroy = function(cb) { setImmediate(cb) };
    e.swarm = {
        wires: [], queued: 0, _peers: {}, tries: 0, paused: false, connections: [], size: 0,
        downloaded: 0, uploaded: 0,
        downloadSpeed: function() { return 10 },
        uploadSpeed: function() { return 3 },
        resume: function() { }, pause: function() { }, on: function() { }
    };
    return e;
}

var nextFiles = null;
// inactivity timers would otherwise keep the test process alive for a minute
EngineFS.STREAM_TIMEOUT = EngineFS.ENGINE_TIMEOUT = 10;
EngineFS.getDefaults = function() { return { } }; // no peer search: nothing goes to the network
EngineFS.engine = function(torrent, options) {
    var ih = /btih:([^&]+)/.exec(torrent)[1];
    return fakeEngine(ih, nextFiles.files, nextFiles.opts);
};

function hash(c) { return new Array(41).join(c) }

function withServer(fn)
{
    var server = EngineFS.http();
    return new Promise(function(resolve) { server.listen(0, resolve) })
        .then(function() { return fn("http://127.0.0.1:" + server.address().port) })
        .finally(function() { server.close() });
}

function removeAll()
{
    return Promise.all(EngineFS.list().map(function(ih) {
        return new Promise(function(resolve) { EngineFS.remove(ih, resolve) });
    }));
}

function create(ih, files, opts)
{
    nextFiles = { files: files, opts: opts };
    return new Promise(function(resolve) { EngineFS.create(ih, { }, function(err, e) { resolve(e) }) });
}

test("an invalid ?f= pattern is ignored instead of throwing", function() {
    var ih = hash("a");
    nextFiles = { files: [{ name: "movie.mkv", length: 100 }] };
    return withServer(function(base) {
        return fetch(base + "/" + ih + "/0?f=" + encodeURIComponent("(")).then(function(res) {
            assert.strictEqual(res.status, 200);
            return res.arrayBuffer();
        }).then(function(body) {
            assert.strictEqual(body.byteLength, 100);
        });
    });
});

test("a valid ?f= pattern still selects the matching file", function() {
    var ih = hash("b");
    nextFiles = { files: [{ name: "sample.mkv", length: 10 }, { name: "S01E02.mkv", length: 20 }] };
    return withServer(function(base) {
        return fetch(base + "/" + ih + "/0?f=" + encodeURIComponent("/s01e02/i")).then(function(res) {
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.headers.get("content-length"), "20");
            return res.arrayBuffer();
        });
    });
});

test("an unsatisfiable range gets 416", function() {
    var ih = hash("c");
    nextFiles = { files: [{ name: "movie.mkv", length: 100 }] };
    return withServer(function(base) {
        return fetch(base + "/" + ih + "/0", { headers: { Range: "bytes=500-" } }).then(function(res) {
            assert.strictEqual(res.status, 416);
            assert.strictEqual(res.headers.get("content-range"), "bytes */100");
        });
    });
});

test("a range request returns 206 with the requested bytes", function() {
    var ih = hash("7");
    nextFiles = { files: [{ name: "movie.mkv", length: 100 }] };
    return withServer(function(base) {
        return fetch(base + "/" + ih + "/0", { headers: { Range: "bytes=10-19" } }).then(function(res) {
            assert.strictEqual(res.status, 206);
            assert.strictEqual(res.headers.get("content-range"), "bytes 10-19/100");
            return res.arrayBuffer();
        }).then(function(body) {
            assert.strictEqual(body.byteLength, 10);
        });
    });
});

test("a path segment that only contains an info hash is rejected", function() {
    var ih = hash("8");
    nextFiles = { files: [{ name: "movie.mkv", length: 100 }] };
    return withServer(function(base) {
        return fetch(base + "/xyz" + ih + "abc/0").then(function(res) {
            assert.strictEqual(res.status, 500);
            assert.strictEqual(EngineFS.exists("xyz" + ih + "abc"), false, "no engine is created for the bogus hash");
        });
    });
});

test("stream progress stays within 0..1 for files not aligned to pieces", function() {
    var ih = hash("d");
    // starts in the middle of piece 0 and ends in piece 1: two pieces for 100 bytes
    return create(ih, [{ name: "a.txt", length: 50 }, { name: "movie.mkv", length: 100 }], { complete: true }).then(function() {
        var stats = EngineFS.stats(ih, 1);
        assert.strictEqual(stats.streamProgress, 1);
    });
});

test("uploadSpeed reports the swarm upload speed", function() {
    var ih = hash("e");
    return create(ih, [{ name: "movie.mkv", length: 100 }]).then(function() {
        var stats = EngineFS.stats(ih);
        assert.strictEqual(stats.downloadSpeed, 10);
        assert.strictEqual(stats.uploadSpeed, 3);
    });
});

test("stats routes accept an upper case info hash", function() {
    var ih = hash("f");
    return create(ih, [{ name: "movie.mkv", length: 100 }]).then(function() {
        return withServer(function(base) {
            return fetch(base + "/" + ih.toUpperCase() + "/stats.json").then(function(res) { return res.json() });
        });
    }).then(function(stats) {
        assert.ok(stats, "stats are found");
        assert.strictEqual(stats.infoHash, ih);
    });
});

test("keepConcurrency does not remove engines when reusing an existing one", function() {
    var a = hash("1"), b = hash("2");
    return removeAll()
        .then(function() { return create(a, [{ name: "a.mkv", length: 100 }]) })
        .then(function() { return create(b, [{ name: "b.mkv", length: 100 }]) })
        .then(function() { return EngineFS.keepConcurrency(a, 2) })
        .then(function() {
            assert.ok(EngineFS.exists(a), "the reused engine is kept");
            assert.ok(EngineFS.exists(b), "the other engine is kept too");
        });
});

test("guessFileIdx ignores files that only end like a media extension", function() {
    var files = [
        { path: "Extras/Credits", length: 5000 },
        { path: "Movie.2020.1080p.mkv", length: 1000 },
        { path: "sample_mp4", length: 3000 }
    ];
    assert.strictEqual(guessFileIdx(files, {}), 1);
});

test.after(removeAll);
