// var linvofs = require("../linvofs");
var child=require("child_process");
var linvofsProc = child.fork("./linvofs.js");
var dnode = require("dnode");
var d = dnode();
d.on("data",function(d) { linvofsProc.send(d) });
linvofsProc.on("message",function(msg) { d.write(msg) });

d.on("remote", function(linvofs)
{
	linvofs.http(11471);
});
