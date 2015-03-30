'use strict';
let http      = require('http'),
    koa       = require('koa'),
    serve     = require('koa-static'),
    views     = require('co-views'),
    socketIo  = require('socket.io'),
    IsMobile  = require('ismobilejs'),
    game      = require('./game');

let app, render, server, io;

app = koa();

render = views(__dirname + '/views/', { default: 'jade' });

app.use(serve(__dirname + '/public'));

app.use(function *(){
  let isMobile = IsMobile(this.headers['user-agent']);
  if(isMobile.any){
    this.body = yield render('indexmobile');
  }
  else{
    this.body = yield render('index');
  }
});

server = http.Server(app.callback());

io = socketIo(server);

game.setup(io);

server.listen(3000);

