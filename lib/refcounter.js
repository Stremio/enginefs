// Increment/decrement a counter on `incEv`/`decEv`; generate the ID of the counter with `idFn`
// Calls `onPositive` when counter is >0 and `onZero` when counter has stayed on 0 for `timeout` milliseconds
function Counter(evs, incEv, decEv, idFn, onPositive, onZero, timeout)
{
    var counter = {}, timeouts = {};
    evs.on(incEv, function(hash, idx) {
        var id = idFn(hash, idx);
        if (! counter.hasOwnProperty(id)) { counter[id] = 0; onPositive(hash, idx); }
        counter[id]++;

        if (timeouts[id]) {
            clearTimeout(timeouts[id]);
            delete timeouts[id];
        };
    });
    evs.on(decEv, function(hash, idx) {
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

module.exports = Counter;