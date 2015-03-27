'use strict';
let rethinkdbdash = require('rethinkdbdash');

let r = rethinkdbdash({db: 'dotracing'});

module.exports = r;