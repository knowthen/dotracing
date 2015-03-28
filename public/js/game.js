(function(){
var app = angular.module('dotRacing.game', []);
var Engine = Matter.Engine,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Body = Matter.Body,
    Events = Matter.Events;

app.directive('gameBoard', function(){
  return {
    restrict: 'AE',
    replace: 'true',
    template: '<div></div>',
    scope: {
      engine: '='
    },
    link: function(scope, elem, attrs){
      scope.engine.attach(elem[0]);
    }
  };
});

app.factory('GameFactory', function(){
  return {
    createGame: function(options){
      return new Game(options);
    }
  }
});

function Game (options) {
  var that;
  that = this;
  this.socket = options.socket;
  this.eventEmitter = new EventEmitter();
  this.players = {};
  this.finished = 0;
  this.gameId = options.gameId;

  this.width = 800;
  this.height = 600;

  this.board = options.board || defaultDefaultBoard(this.width, this.height);
  this.laps = options.laps || 4;
  startLine = this.board.startLine;
  this.finishLineLeft = startLine.x - startLine.width / 2;
  this.finishLineRight = startLine.x + startLine.width / 2;
  this.finishLineY = startLine.y - startLine.height / 2;

  this.speed = 50;

  this.playerColors = [
    '#FF0000',
    '#33CC33',
    '#0033CC',
    '#FF9900'
  ];
  this.addPlayerHandler = function(player){
    that.addPlayer(player);
  }
  this.applyForceHandler = function (force){
    that.applyForce(force);
  }
  this.growHandler = function (playerId){
    that.grow(playerId);
  }
  function forceLoop () {
    var force;
    var forceMultipler = 0.025;
    for (var id in that.players){
      var player = that.players[id];
      force = null;
      if(player.forceQueue && player.forceQueue.length > 0){
        force = player.forceQueue.shift();
        if(force){

          Body.applyForce(player,
            {x: 0, y: 0},
            {x: force.x * forceMultipler, y: -1 * force.y * forceMultipler}
          );
        }
      }
    }
    if(!that.stopped){
      setTimeout(forceLoop, 100);
    }
  }
  this.forceLoop = forceLoop;
}

Game.prototype.emit = function(event, data) {
  this.eventEmitter.emit(event, data)
};

Game.prototype.on = function(event, fn) {
  this.eventEmitter.on(event, fn);
};

Game.prototype.attach = function(elem) {
  this.elem = elem;
  this._init();
  this.emit('ready');
};

Game.prototype.playerCount = function() {
  return Object.keys(this.players).length;
};

Game.prototype.addPlayer = function(player) {
  var radius, x, y, body, density, restitution, color;
  color = this.playerColors[this.playerCount()];
  radius = player.radius || this.width * 0.02;
  x = player.x || this.width / 16 + radius * 2.2 * this.playerCount() - 1;
  y = this.finishLineY - radius * 1.5;
  density = player.density || 0.08;
  restitution = player.restitution || 0.5;
  body = Bodies.circle(x, y, radius, 
    { 
      density: density, 
      restitution: restitution,
      collisionFilter: {
        group: 1,
        category: 0x0001,
        mask: 0x0001
      },
      render: {
        fillStyle: color,
        strokeStyle: color
      }
    });
  body.playerId = player.id;
  body.maxRadius = radius * 1.8;
  body.minRadius = radius;
  body.color = color;
  this.socket.emit('player:color', {
    gameId: this.gameId,
    playerId: player.id,
    color: color
  });
  body.forceQueue = [];
  this.players[player.id] = body;
  if(this.engine){
    World.add(this.engine.world, body);
  }
};

Game.prototype.applyForce = function(force) {
  var player, forceMultipler;
  if(!this.started || this.stopped){
    return;
  }
  player = this.players[force.playerId]
  player.forceQueue = [];
  player.forceQueue.push(force);
  player.forceQueue.push(force);
  player.forceQueue.push(force);
};

Game.prototype.grow = function(playerId) {
  var player, newRadius;
  if(!this.started || this.stopped){
    return;
  }
  player = this.players[playerId];
  newRadius = player.circleRadius * 1.20;
  if(newRadius <= player.maxRadius){
    player.circleRadius = newRadius;
    Body.scale(player, 1.2, 1.2);
    player.density = player.density / 1.2;
  }
};

Game.prototype.shrink = function(player) {
  var newRadius, that;
  that = this;
  newRadius = player.circleRadius * 0.9;
  if(newRadius >= player.minRadius){
    player.circleRadius = newRadius;
    Body.scale(player, 0.9, 0.9);
    player.density = player.density / 0.9;
  }
  
  if(this.stopped){
    return;
  }
  else{
    setTimeout(function(){
      that.shrink(player);
    }, 2000);
  } 
};

Game.prototype._drawBoard = function() {
  var startLine, that;
  that = this;
  this.board.walls.forEach(function(wall){
    World.add(that.engine.world, 
      Bodies.rectangle(wall.x, wall.y, wall.width, wall.height, 
        { 
          isStatic: true,
          render: {
            fillStyle: '#595959',
            strokeStyle: '#595959'
          }
        }
        ))
  });
  startLine = this.board.startLine;

  World.add(this.engine.world,
      Bodies.rectangle(startLine.x, startLine.y, startLine.width, startLine.height, 
      {
        isStatic: true,
        collisionFilter: {
          group: 2,
          category: 0x0002,
          mask: 0x0002
        },
        render: {
          fillStyle: '#E74C3C',
          strokeStyle: '#E74C3C'
        }
      }
      ));
};

Game.prototype._drawPlayer = function(player) {
  World.add(this.engine.world, player);
};

Game.prototype._drawPlayers = function() {
  for (var id in this.players){
    if (this.players.hasOwnProperty(id)) {
      this._drawPlayer(this.players[id]);
    }
  }
};

Game.prototype._init = function() {
  var renderOptions, that;
  that = this;
  this.engine = Engine.create(this.elem, {render: {options: {width: this.width, height: this.height}}});
  this.engine.world.gravity.y = 0;
  this.engine.world.bounds.max.y = this.height;
  this.engine.world.bounds.max.x = this.width;
  renderOptions = this.engine.render.options;
  renderOptions.wireframes = false;
  this._drawBoard();
  this._drawPlayers();
  Engine.run(this.engine);
  this.socket.on('player:add', this.addPlayerHandler);
  this.socket.on('force', this.applyForceHandler);
  this.socket.on('grow', this.growHandler);
};

Game.prototype._playerTick = function(player) {
  var lastY, currentY, currentX, lap, place, info, lapStart, lapTime, raceTime;
  if(!this.counter){
    this.counter = 1;
  }

  if(player.position.last){
    lastY = player.position.last.y;
  };
  currentX = player.position.x;
  currentY = player.position.y + player.circleRadius;
  
  this.counter++;
  if(this.finishLineLeft <= currentX &&
     this.finishLineRight >= currentX){
    if(lastY < this.finishLineY && 
      currentY >= this.finishLineY ){
      lapStart = player.lapStart || this.startTime;
      lapEnd = new Date;
      player.lapStart = lapEnd;
      if(lapStart && lapEnd){
        lapTime = lapEnd.getTime() - lapStart.getTime();
        lapTime = lapTime / 1000;
      }
      lap = player.lap || 0;
      player.lap = lap + 1;
      info = {
        gameId: this.gameId,
        playerId: player.playerId,
        lap: player.lap,
        lapTime: lapTime
      };
      if(player.lap > 1){
        this.emit('lap', info);
        this.socket.emit('lap', info);
      }
      
      if(!player.place && player.lap >= this.laps && player.lap > 1){

        raceTime = (lapEnd.getTime() - this.startTime.getTime()) / 1000;
        info.raceTime = raceTime;
        info.place = this.finished = ++this.finished;
        player.place = info.place;
        this.emit('finish', info);
        this.socket.emit('finish', info);
      }
    }
    else if (lastY >= this.finishLineY && 
      currentY < this.finishLineY ){
      lap = player.lap || -1;
      player.lap = lap + 1;
      info = {
        gameId: this.gameId,
        playerId: player.playerId,
        lap: player.lap
      };
      this.emit('lap', info);
      this.socket.emit('lap', info);
    }
    
  }
  player.position.last = {
    y: currentY,
    x: currentX
  };
};

Game.prototype._tick = function() {
  var player;
  for (var id in this.players){
    if (this.players.hasOwnProperty(id)) {
      player = this.players[id];
      this._playerTick(player);
    }
  }
};

Game.prototype._start = function() {
  this.emit('started');
  this.socket.emit('game:started', this.gameId);
  this.started = true;
  this.startTime = new Date
  this.forceLoop();
  for (var id in this.players){
    if (this.players.hasOwnProperty(id)) {
      this.shrink(this.players[id]);
    }
  }
};

Game.prototype._stop = function() {
  this.emit('stopped');
  this.socket.emit('game:stopped', this.gameId);
  this.stopped = true;
};

Game.prototype._timer = function(seconds) {
  var that;
  that = this;
  this.emit('timer', seconds);
  seconds--;
  if(seconds > 0){
    setTimeout(function(){
      that._timer(seconds);
    }, 1000);
  }
  else{
    setTimeout(function(){
      that._start();
    }, 1000);
  }
};

Game.prototype.start = function() {
  var seconds, that;
  seconds = 3;
  that = this;
  setTimeout(function(){
    that.emit('timer', 'Starting In...');
  })
  setTimeout(function(){
    that._timer(seconds);
  }, 1500)
  
  Events.on(this.engine, 'afterTick', function(){
    that._tick();
  });
};

Game.prototype.destroy = function() {
  this.stopped = true;
  Events.off(this.engine, 'afterTick');
  World.clear(this.engine.world);
  Engine.clear(this.engine);
  this.eventEmitter.removeAllListeners();
  this.socket.emit('game:stopped', this.gameId);
  this.socket.removeListener('player:add', this.addPlayerHandler);
  this.socket.removeListener('force', this.applyForceHandler);
  this.socket.removeListener('grow', this.growHandler);
};

function defaultDefaultBoard (width, height) {
  var board = {};
  board.walls = [];
  var left, right, top, bottom, middle, middleLeft, middleRight, topMid, wallWidth;
  wallWidth = 10;
  left = {
    x: wallWidth / 2, y: height / 2, width: wallWidth, height: height
  };
  right = {
    x: width - wallWidth / 2, y: height / 2, width: wallWidth, height: height
  };
  top = {
    x: width / 2, y: wallWidth / 2, width: width, height: wallWidth
  };
  bottom = {
    x: width / 2, y: height - wallWidth / 2, width: width, height: wallWidth
  };
  middle = {
    x: (width - wallWidth) / 2, y: height / 2 + height * 0.2, width: wallWidth, height: height * 0.6
  }
  middleLeft = {
    x: (width - wallWidth) / 4, y: height / 2, width: wallWidth, height: height * 0.6
  }
  middleRight = {
    x: (width - wallWidth) / 4 * 3, y: height / 2, width: wallWidth, height: height * 0.6
  }
  topMid = {
    x: (width - wallWidth) / 2, y: height * 0.2 + wallWidth / 2, width: width / 2 + wallWidth / 2, height: wallWidth
  }
  
  board.walls.push(left);
  board.walls.push(right);
  board.walls.push(top);
  board.walls.push(bottom);
  board.walls.push(middle);
  board.walls.push(middleLeft);
  board.walls.push(middleRight);
  board.walls.push(topMid);

  board.startLine = {
    x: (width - wallWidth) / 8 ,
    y: height * 0.25 + wallWidth / 2,
    width: (width - wallWidth) / 4 * 0.8,
    height: wallWidth
  }
  return board;
}

})();